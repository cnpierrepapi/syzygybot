// Sequencer: turns each drafted first message into a schedule.
// Email gets three steps (first note, a follow-up with one new number, a last note); a letter is one
// piece of paper, so it gets one step. Every step lands Tue–Thu 09:00–11:30 in the recipient's own
// time zone, no more than DAILY_CAP messages a day overall and one per company per day. Before
// scheduling it checks the do-not-contact list, and every message carries an opt-out link and a
// postal address. Nothing is sent here: a step leaves only after a person approves it (lib/mail.ts).

import { sql } from "./db";
import { logAction } from "./actions";
import { ask, parseJson } from "./llm";
import { writerChecks } from "./outreach";
import { SITE, fillSlugs, token } from "./slug";
import { followUpAs } from "./inward";

export const DAILY_CAP = 20;
const GAP_BUSINESS_DAYS = [0, 4, 6]; // step 2 four business days after step 1, step 3 six after step 2
const WINDOW = { days: new Set(["Tue", "Wed", "Thu"]), start: 9 * 60, end: 11 * 60 + 30, slot: 15 };

const FALLBACK_TZ: Record<string, string> = {
  it: "Europe/Rome", es: "Europe/Madrid", fr: "Europe/Paris", de: "Europe/Berlin", uk: "Europe/London",
  nl: "Europe/Amsterdam", se: "Europe/Stockholm", ch: "Europe/Zurich", jp: "Asia/Tokyo", kr: "Asia/Seoul",
  au: "Australia/Sydney", ca: "America/Toronto", br: "America/Sao_Paulo", mx: "America/Mexico_City",
};

const validTz = (tz: string | null | undefined): tz is string => {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};

/** Weekday, local date and minutes past midnight for an instant in a time zone. */
export function local(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { weekday: p.weekday, date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const inWindow = (d: Date, tz: string) => {
  const l = local(d, tz);
  return WINDOW.days.has(l.weekday) && l.minutes >= WINDOW.start && l.minutes <= WINDOW.end;
};

type Booked = { perDay: Map<string, number>; perCompanyDay: Set<string> };

/** First free slot at or after `after`: inside the window, under the daily cap, one per company per local day. */
export function nextSlot(after: Date, tz: string, company: string, booked: Booked) {
  const step = WINDOW.slot * 60_000;
  let t = new Date(Math.ceil(after.getTime() / step) * step);
  for (let i = 0; i < 96 * 60; i++, t = new Date(t.getTime() + step)) {
    if (!inWindow(t, tz)) continue;
    const day = t.toISOString().slice(0, 10), key = `${company}|${local(t, tz).date}`;
    if ((booked.perDay.get(day) ?? 0) >= DAILY_CAP || booked.perCompanyDay.has(key)) continue;
    booked.perDay.set(day, (booked.perDay.get(day) ?? 0) + 1);
    booked.perCompanyDay.add(key);
    return t;
  }
  throw new Error("no free slot in 60 days");
}

/** `n` business days later in the recipient's zone (weekends skipped). */
export function addBusinessDays(d: Date, n: number, tz: string) {
  let t = d;
  while (n > 0) { t = new Date(t.getTime() + 864e5); if (!["Sat", "Sun"].includes(local(t, tz).weekday)) n--; }
  return t;
}

async function booked(): Promise<Booked> {
  const rows = (await sql()`
    select t.scheduled_for, ac.entity_id, coalesce(ac.tz, 'UTC') tz from touches t
    join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id
    where t.scheduled_for is not null and t.status <> 'cancelled'`) as { scheduled_for: string; entity_id: string; tz: string }[];
  const b: Booked = { perDay: new Map(), perCompanyDay: new Set() };
  for (const r of rows) {
    const d = new Date(r.scheduled_for), day = d.toISOString().slice(0, 10);
    b.perDay.set(day, (b.perDay.get(day) ?? 0) + 1);
    b.perCompanyDay.add(`${r.entity_id}|${local(d, validTz(r.tz) ? r.tz : "UTC").date}`);
  }
  return b;
}

type Acct = { id: string; entity_id: string; name: string; official_site: string | null; tz: string | null; hq: string | null };

/** The recipient's IANA zone: cached on the account, else asked once, else guessed from the domain. */
async function zoneFor(a: Acct, email: string | null) {
  if (validTz(a.tz)) return { tz: a.tz, cost: 0 };
  let tz: string | null = null, cost = 0;
  try {
    const r = await ask("fast", "Reply with JSON only.", `IANA time zone of the head office of "${a.name}"${a.hq ? ` (headquartered in ${a.hq})` : ""}${a.official_site ? `, site ${a.official_site}` : ""}. {"tz":"Area/City"}`, 60);
    cost = r.costUsd ?? 0;
    tz = parseJson<{ tz: string }>(r.text)?.tz ?? null;
  } catch { /* fall through to the domain */ }
  if (!validTz(tz)) {
    const host = (email?.split("@")[1] ?? a.official_site?.replace(/^https?:\/\//, "").split("/")[0] ?? "").toLowerCase();
    tz = FALLBACK_TZ[host.split(".").pop() ?? ""] ?? "America/New_York";
  }
  await sql()`update accounts set tz = ${tz} where entity_id = ${a.entity_id}`;
  return { tz: tz!, cost };
}

const domainOf = (s: string | null) => (s ? s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/@]/).pop()!.split("/")[0] : null);

/** Do-not-contact holds addresses and whole domains. */
export async function blocked(address: string | null, site: string | null) {
  const values = [address?.toLowerCase(), domainOf(address), domainOf(site)].filter(Boolean) as string[];
  if (!values.length) return null;
  const [hit] = (await sql()`select value, reason from do_not_contact where value = any(${values})`) as { value: string; reason: string }[];
  return hit ?? null;
}

/** What gets appended at send time. Shown on the message page now so the rule is visible. */
export function footer(optoutToken: string) {
  const postal = process.env.SYZYGY_POSTAL_ADDRESS?.trim();
  return `--\nSYZYGY is an AI agent built and run by Onenept Studios Inc. To stop every message from it: ${SITE}/optout/${optoutToken}\n${postal || "[postal address added before anything is sent]"}`;
}

const FOLLOW_SYSTEM = `You are the Sequencer on an autonomous sales team built on Qloo's taste data. You write one short
follow-up to a cold email that got no reply. Hard rules:
- The first sentence says plainly it is Syzygy, an AI agent, following up.
- Say the analysis is built on Qloo's taste data. You are NOT Qloo; never imply you work for Qloo.
- Affinity values are scores from 0 to 1, never percentages.
- Use only numbers from the evidence. Do not invent any number, client or result. No em dashes, no exclamation marks, no hype.
- Sign off as "Syzygy (an AI agent)".
Reply with JSON only: {"body":""}`;

const STEP_BRIEF: Record<number, string> = {
  2: "Step 2, under 80 words: add ONE fact from the evidence the first message did not use (another partner with both its scores, or a shared city), repeat the ask, include the evidence link.",
  3: "Step 3, the last note, under 60 words: say this is the last message, restate the single strongest number, leave the evidence link, no ask beyond a reply.",
};

async function writeFollowUp(first: { subject: string | null; body: string }, evidence: unknown, link: string, step: number) {
  const prompt = JSON.stringify({ brief: STEP_BRIEF[step], first_message: first.body, evidence, evidence_link: link });
  let cost = 0, checks = writerChecks("", "");
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ask("write", FOLLOW_SYSTEM, attempt ? `${prompt}\n\nYour last draft broke a hard rule: ${JSON.stringify(checks)}. Fix it.` : prompt, 300);
    cost += r.costUsd ?? 0;
    const body = parseJson<{ body: string }>(r.text)?.body;
    if (!body) continue;
    checks = writerChecks(body, "");
    if (Object.values(checks).every(Boolean)) return { body, checks, model: r.model, cost };
  }
  return { body: null, checks, model: "", cost };
}

/** Cancels every unsent step for a contact (a reply came in) or for an address (an opt-out). */
export async function stopSequence(by: { contactId?: string; address?: string; afterStep?: number }, reason: string) {
  const rows = (await sql()`
    update touches set status = 'cancelled', detail = detail || ${JSON.stringify({ cancelled: reason })}::jsonb
    where status in ('draft','dry_run','queued')
      and ((${by.contactId ?? null}::uuid is not null and contact_id = ${by.contactId ?? null}::uuid and step > ${by.afterStep ?? 0})
        or (${by.address ?? null}::text is not null and lower(to_address) = lower(${by.address ?? null})))
    returning id`) as { id: string }[];
  return rows.length;
}

/** Schedules first messages that have no slot yet, and writes their follow-ups. */
export async function runSequencer(limit = 10) {
  const firsts = (await sql()`
    select t.id, t.contact_id, t.plan_id, t.channel, t.subject, t.body, t.to_address, c.name contact_name, c.role,
           ac.id account_id, ac.slug account_slug, t.optout_token, ac.entity_id, ac.evidence, ac.tz, e.name, e.official_site, e.raw->'properties'->>'headquartered' hq,
           t.workspace_id, w.signer, wb.name ws_name
    from touches t join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    left join workspaces w on w.id = t.workspace_id left join entities wb on wb.qloo_id = w.entity_id
    where t.step = 1 and t.status = 'dry_run' and t.scheduled_for is null
      and exists (select 1 from pairs p where p.id = ac.pair_id and p.deal_status in ('clear','past'))
    order by t.created_at asc limit ${limit}`) as (Acct & {
      id: string; contact_id: string; plan_id: string | null; channel: string; subject: string | null; body: string;
      to_address: string | null; contact_name: string | null; role: string; account_id: string; evidence: Record<string, unknown>;
      account_slug: string | null; optout_token: string | null; workspace_id: string | null; signer: string | null; ws_name: string | null;
    })[];
  const b = await booked();
  const out = [];
  for (const t of firsts) {
    const who = t.contact_name ?? `${t.name}'s ${t.role}`;
    const dnc = await blocked(t.to_address, t.official_site);
    if (dnc) {
      await stopSequence({ contactId: t.contact_id }, `do-not-contact: ${dnc.reason}`);
      await sql()`update touches set status = 'cancelled', detail = detail || ${JSON.stringify({ cancelled: `do-not-contact: ${dnc.reason}` })}::jsonb where id = ${t.id}`;
      await logAction({ agent: "sequencer", kind: "touch.suppressed", summary: `Did not schedule ${who}: ${t.name} is on the do-not-contact list.`, refTable: "touches", refId: t.id });
      out.push({ touch: t.id, suppressed: true });
      continue;
    }
    const { tz, cost: tzCost } = await zoneFor({ ...t, id: t.account_id }, t.to_address);
    const first = nextSlot(new Date(Date.now() + 36e5), tz, t.entity_id, b);
    const tok = t.optout_token ?? token();
    await sql()`update touches set scheduled_for = ${first.toISOString()}, optout_token = ${tok}, detail = detail || ${JSON.stringify({ tz, footer: footer(tok) })}::jsonb where id = ${t.id}`;
    let steps = 1, cost = tzCost, at = first;
    const skipped: string[] = [];
    if (t.channel === "email") {
      const link = `${SITE}/account/${t.account_slug ?? t.account_id}`;
      for (const step of [2, 3]) {
        // A thread signed as a claimed brand follows up in that brand's name too.
        const f = t.workspace_id && t.ws_name
          ? await followUpAs({ name: t.ws_name, signer: t.signer }, STEP_BRIEF[step], t.body, t.evidence, link)
          : await writeFollowUp(t, t.evidence, link, step);
        cost += f.cost;
        if (!f.body) { skipped.push(`step ${step} broke a hard rule twice`); break; }
        at = nextSlot(addBusinessDays(at, GAP_BUSINESS_DAYS[step - 1], tz), tz, t.entity_id, b);
        const followTok = token();
        const [row] = (await sql()`
          insert into touches (contact_id, plan_id, channel, step, subject, body, status, to_address, scheduled_for, optout_token, workspace_id, detail)
          values (${t.contact_id}, ${t.plan_id}, 'email', ${step}, ${`Re: ${t.subject ?? ""}`}, ${f.body}, 'dry_run', ${t.to_address}, ${at.toISOString()}, ${followTok}, ${t.workspace_id},
                  ${JSON.stringify({ model: f.model, checks: f.checks, tz, first_touch: t.id, ...(t.ws_name ? { signed_as: t.ws_name } : {}) })})
          returning id`) as { id: string }[];
        await sql()`update touches set detail = detail || ${JSON.stringify({ footer: footer(followTok) })}::jsonb where id = ${row.id}`;
        steps++;
      }
    }
    const when = (d: Date) => `${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d)} ${tz}`;
    await logAction({
      agent: "sequencer", kind: "sequence.scheduled",
      summary: t.channel === "letter"
        ? `Scheduled the letter to ${who} at ${t.name} for ${when(first)}. One letter, no paper follow-ups.`
        : `Scheduled ${steps} emails to ${who} at ${t.name}, first ${when(first)}. Stops on any reply or opt-out.`,
      refTable: "touches", refId: t.id, detail: { tz, skipped }, llmCostUsd: cost,
    });
    out.push({ touch: t.id, tz, steps, first: first.toISOString() });
  }
  if (out.length) await fillSlugs();
  return out;
}
