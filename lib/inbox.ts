// Inbox agent: reads a reply, sorts it, and acts on it.
//   interested → answers any question with FRESH Qloo queries, then hands the thread to a person
//                (the agents don't book meetings; a human takes it from here and refers it to Qloo).
//   not_now    → stops the sequence, notes a date to look again, answers questions if asked.
//   referral   → stops the sequence, adds the person they pointed to, and the Writer drafts to them.
//   opt_out    → do-not-contact, every unsent message to that address cancelled. No reply.
//   ooo        → pushes the remaining steps past the return date. No reply.
// Replies are stored with a `simulated` flag until the mailbox exists. A simulated reply is sorted and
// answered for real, but runs in shadow: it never cancels a real sequence, never adds to do-not-contact
// and never creates a contact; the page lists what it WOULD have done. Shown only if SHOW_SIMULATED=1.

import { tool } from "ai";
import { z } from "zod";
import { sql } from "./db";
import { logAction } from "./actions";
import { ask, askTools, parseJson } from "./llm";
import { audienceTags, demographics, pull, search, topFor, type EntityType } from "./qloo";
import { addBusinessDays, nextSlot, stopSequence } from "./sequencer";
import { writeTouch, type AccountRow } from "./outreach";
import { SITE, fillSlugs } from "./slug";

export const CLASSES = ["interested", "not_now", "referral", "opt_out", "ooo", "other"] as const;
type Class = (typeof CLASSES)[number];

const CLASSIFY_SYSTEM = `You sort replies to a cold email for an autonomous sales team. Reply with JSON only:
{"class":"interested|not_now|referral|opt_out|ooo|other","questions":["each question they asked, verbatim or close"],
"referral":{"name":"","role":"","email":""} or null,"return_date":"YYYY-MM-DD" or null,"revisit_date":"YYYY-MM-DD" or null,"summary":"one line"}
interested = wants to talk or learn more. not_now = maybe later. referral = points to someone else. opt_out = asks to stop,
unsubscribe, remove, or is hostile. ooo = automatic out-of-office. Only fill referral.email if the reply literally contains it.`;

const ANSWER_SYSTEM = `You are the Inbox agent of SYZYGY, an autonomous sales team. You are an AI agent and say so.
Answer the prospect's questions using ONLY numbers returned by the Qloo tools you call now; call a tool for every
number you quote. The analysis is built on Qloo's taste data, but you are NOT Qloo and never imply you work for Qloo.
Affinity values are scores from 0 to 1, never percentages. If a tool returns nothing, say the data has no answer.
Never invent clients, prices or results. No em dashes, no exclamation marks, no hype. Under 140 words.
If they are interested, end by saying a person will pick up this thread directly. Sign off "Syzygy (an AI agent)".`;

const typeOf = (types?: string[]) => (types?.[0]?.replace("urn:entity:", "") ?? "brand") as EntityType;

/** Live Qloo tools; every call is recorded so the reply page can show exactly what was queried. */
function qlooTools(log: { tool: string; input: unknown; output: unknown }[]) {
  const find = async (name: string) => (await search(name, undefined, 1))[0] ?? null;
  const record = <T,>(name: string, input: unknown, output: T) => { log.push({ tool: name, input, output }); return output; };
  return {
    affinity: tool({
      description: "How much the audience of `from` likes `to`, as a 0-1 Qloo affinity score.",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      execute: async ({ from, to }) => {
        const [a, b] = await Promise.all([find(from), find(to)]);
        if (!a || !b) return record("affinity", { from, to }, { error: "entity not found" });
        const p = await pull([a.entity_id], b.entity_id, typeOf(b.types));
        return record("affinity", { from, to }, { from: a.name, to: b.name, affinity: p?.affinity ?? null });
      },
    }),
    top_matches: tool({
      description: "Top entities of a type (artist, brand, movie, tv_show, place, podcast, book, videogame) that `name`'s audience likes, with affinity.",
      inputSchema: z.object({ name: z.string(), type: z.enum(["artist", "brand", "movie", "tv_show", "place", "podcast", "book", "videogame"]) }),
      execute: async ({ name, type }) => {
        const e = await find(name);
        if (!e) return record("top_matches", { name, type }, { error: "entity not found" });
        const rows = await topFor([e.entity_id], type as EntityType, 8);
        return record("top_matches", { name, type }, rows.map(r => ({ name: r.name, affinity: r.query?.affinity ?? null })));
      },
    }),
    audience_taste: tool({
      description: "Taste tags the audience of `name` over-indexes on, across domains.",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        const e = await find(name);
        if (!e) return record("audience_taste", { name }, { error: "entity not found" });
        return record("audience_taste", { name }, (await audienceTags([e.entity_id], 30)).slice(0, 15));
      },
    }),
    audience_demographics: tool({
      description: "Age and gender skew of the audience of `name` (Qloo demographics, relative to the general population).",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        const e = await find(name);
        if (!e) return record("audience_demographics", { name }, { error: "entity not found" });
        const r = await demographics([e.entity_id]);
        return record("audience_demographics", { name }, r.results ?? null);
      },
    }),
  };
}

export const answerChecks = (body: string) => ({
  says_ai_agent: /\bai agent\b/i.test(body),
  not_posing_as_qloo: !/(we at qloo|i work (at|for) qloo|from qloo['’]s team|on behalf of qloo|our qloo|i('m| am) (from|with) qloo)/i.test(body),
  no_em_dash: !/—/.test(body),
  no_percentages: !/%|\bper ?cent\b/i.test(body),
});

type Thread = {
  id: string; contact_id: string; plan_id: string | null; step: number; subject: string | null; body: string; to_address: string | null;
  contact_name: string | null; role: string; account_id: string;
};

async function loadAccount(id: string) {
  const [a] = (await sql()`
    select ac.id, ac.slug, ac.entity_id, ac.evidence, ac.tz, e.name, e.type, e.official_site, p.name passed_name
    from accounts ac join entities e on e.qloo_id = ac.entity_id left join entities p on p.qloo_id = ac.passed_on
    where ac.id = ${id}`) as (AccountRow & { tz: string | null })[];
  return a;
}

/** Handles one reply to one touch. `simulated` marks test replies until the mailbox exists. */
export async function handleReply(touchId: string, text: string, simulated = true) {
  const [t] = (await sql()`
    select t.id, t.contact_id, t.plan_id, t.step, t.subject, t.body, t.to_address, c.name contact_name, c.role, c.account_id
    from touches t join contacts c on c.id = t.contact_id where t.id = ${touchId}`) as Thread[];
  if (!t) throw new Error(`no touch ${touchId}`);
  const a = await loadAccount(t.account_id);
  const who = t.contact_name ?? `${a.name}'s ${t.role}`;
  const tag = simulated ? " (simulated reply)" : "";

  const c = await ask("fast", CLASSIFY_SYSTEM, JSON.stringify({ our_message: t.body, their_reply: text }), 400);
  const parsed = parseJson<{ class: Class; questions?: string[]; referral?: { name?: string; role?: string; email?: string } | null; return_date?: string | null; revisit_date?: string | null; summary?: string }>(c.text);
  const cls: Class = parsed && CLASSES.includes(parsed.class) ? parsed.class : "other";
  let cost = c.costUsd ?? 0;

  const [reply] = (await sql()`
    insert into replies (touch_id, class, body, simulated, detail)
    values (${t.id}, ${cls}, ${text}, ${simulated}, ${JSON.stringify({ summary: parsed?.summary, questions: parsed?.questions ?? [] })})
    returning id`) as { id: string }[];
  const detail = { simulated, reply_id: reply.id };
  await logAction({ agent: "inbox", kind: `reply.${cls}`, summary: `Read a reply from ${who}${tag}: ${cls.replace("_", " ")}. ${parsed?.summary ?? ""}`.trim(), refTable: "replies", refId: reply.id, detail, llmCostUsd: c.costUsd });

  const acted: string[] = [];
  if (simulated) {
    const would: Record<string, string> = {
      opt_out: "Would add the address to do-not-contact and cancel every unsent message",
      ooo: "Would move the remaining follow-ups past the return date",
      referral: `Would add ${parsed?.referral?.name ?? "the person they named"} as a contact and have the Writer draft to them`,
      interested: "Would stop the follow-ups", not_now: "Would stop the follow-ups", other: "Would stop the follow-ups",
    };
    acted.push(`${would[cls]} (shadow run: a simulated reply changes nothing)`);
  } else if (cls === "opt_out") {
    const value = (t.to_address ?? a.official_site?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? a.name).toLowerCase();
    await sql()`insert into do_not_contact (value, reason) values (${value}, ${"asked to stop in a reply"}) on conflict (value) do nothing`;
    const n = t.to_address ? await stopSequence({ address: t.to_address }, "opted out in a reply") : await stopSequence({ contactId: t.contact_id }, "opted out in a reply");
    acted.push(`do-not-contact added, ${n} unsent cancelled`);
    await logAction({ agent: "inbox", kind: "optout.honoured", summary: `${who} asked to stop${tag}. Added to do-not-contact; ${n} unsent message${n === 1 ? "" : "s"} cancelled. No reply sent.`, refTable: "replies", refId: reply.id, detail });
  } else if (cls === "ooo") {
    const back = parsed?.return_date ? new Date(`${parsed.return_date}T00:00:00Z`) : addBusinessDays(new Date(), 5, a.tz ?? "UTC");
    const pending = (await sql()`select id from touches where contact_id = ${t.contact_id} and step > ${t.step} and status = 'dry_run' order by step`) as { id: string }[];
    let at = back;
    for (const p of pending) {
      at = nextSlot(addBusinessDays(at, 1, a.tz ?? "UTC"), a.tz ?? "UTC", a.entity_id, { perDay: new Map(), perCompanyDay: new Set() });
      await sql()`update touches set scheduled_for = ${at.toISOString()} where id = ${p.id}`;
    }
    acted.push(`${pending.length} steps moved past ${back.toISOString().slice(0, 10)}`);
    await logAction({ agent: "inbox", kind: "sequence.paused", summary: `${who} is out of office${tag}. Moved ${pending.length} follow-up${pending.length === 1 ? "" : "s"} to after ${back.toISOString().slice(0, 10)}.`, refTable: "replies", refId: reply.id, detail });
  } else {
    const n = await stopSequence({ contactId: t.contact_id, afterStep: t.step }, `they replied (${cls.replace("_", " ")})`);
    if (n) acted.push(`${n} follow-ups cancelled`);
  }

  if (!simulated && cls === "referral" && parsed?.referral?.name) {
    const r = parsed.referral;
    // Never guessed, and only on the company's own domain: otherwise a reply saying "write to anyone@anywhere"
    // would turn the Writer into a relay for whatever address a stranger chooses.
    const own = [t.to_address?.split("@")[1], a.official_site?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]]
      .filter((d): d is string => !!d).map(d => d.toLowerCase());
    const given = r.email && text.toLowerCase().includes(r.email.toLowerCase()) ? r.email.toLowerCase() : null;
    const email = given && own.some(d => { const h = given.split("@")[1]; return h === d || h.endsWith(`.${d}`); }) ? given : null;
    const [nc] = (await sql()`
      insert into contacts (account_id, kind, name, role, email, email_status, sources, role_status, verified_at, verification)
      values (${a.id}, 'person', ${r.name}, ${r.role || "referred contact"}, ${email}, ${email ? "valid" : "unverified"}, '[]', 'confirmed', now(),
              ${JSON.stringify({ referred_by: who, reply_id: reply.id, simulated })})
      returning id, kind, name, role, email, role_status`) as Parameters<typeof writeTouch>[2][];
    await logAction({ agent: "inbox", kind: "referral.added", summary: `${who} pointed to ${r.name}${r.role ? `, ${r.role}` : ""}${tag}. Added as a contact; a referral from the company counts as verification.`, refTable: "contacts", refId: nc.id, detail });
    const [plan] = (await sql()`select id, angle, detail->>'timing' timing from plans where id = ${t.plan_id}`) as { id: string; angle: string; timing: string }[];
    if (plan) {
      const route = email ? null : (t.to_address ? { id: "", kind: "inbox", name: null, role: "inbox", email: t.to_address, role_status: "confirmed" } : null);
      const id = await writeTouch(a, plan, nc, route, { referred_by: `${who} replied and suggested writing to ${r.name}` });
      if (id) acted.push(`Writer drafted to ${r.name}`);
    }
  }

  let answer: string | null = null;
  const questions = parsed?.questions ?? [];
  if (["interested", "not_now", "other", "referral"].includes(cls) && (questions.length || cls === "interested")) {
    const queries: { tool: string; input: unknown; output: unknown }[] = [];
    const prompt = JSON.stringify({
      account: a.name, evidence_only_partner: a.passed_name, our_message: t.body, their_reply: text, questions, class: cls,
      evidence_link: `${SITE}/account/${a.slug ?? a.id}`,
    });
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      const r = await askTools(ANSWER_SYSTEM, attempt ? `${prompt}\n\nYour last answer broke a hard rule (AI disclosure, never Qloo, no em dash, no percentages). Fix it.` : prompt, qlooTools(queries) as never);
      cost += r.costUsd ?? 0;
      if (r.text && Object.values(answerChecks(r.text)).every(Boolean)) answer = r.text;
    }
    await sql()`update replies set answer = ${answer}, detail = detail || ${JSON.stringify({ queries, checks: answer ? answerChecks(answer) : null })}::jsonb where id = ${reply.id}`;
    await logAction({
      agent: "inbox", kind: answer ? "reply.answered" : "reply.unanswered",
      summary: answer
        ? `Answered ${who}${tag} with ${queries.length} fresh Qloo quer${queries.length === 1 ? "y" : "ies"}. Held as a dry run.`
        : `Could not write an answer to ${who} that passed the rules; left for a person.`,
      refTable: "replies", refId: reply.id, detail, llmCostUsd: cost,
    });
  }
  if (cls === "not_now") {
    const revisit = parsed?.revisit_date ?? new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
    await sql()`update replies set detail = detail || ${JSON.stringify({ revisit })}::jsonb where id = ${reply.id}`;
    acted.push(`look again on ${revisit}`);
  }
  if (cls === "interested") {
    await logAction({ agent: "inbox", kind: "handoff.flagged", summary: `${who} at ${a.name} is interested${tag}. ${simulated ? "In a real run it would go to a person" : "Handed to a person to take the conversation"}; the agents don't book meetings.`, refTable: "replies", refId: reply.id, detail });
    acted.push(simulated ? "Would hand the thread to a person" : "Handed the thread to a person");
  }
  await sql()`update replies set detail = detail || ${JSON.stringify({ acted })}::jsonb where id = ${reply.id}`;
  await fillSlugs();
  return { reply: reply.id, class: cls, acted, answered: !!answer };
}
