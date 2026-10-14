// Handoff. The agents don't book meetings: when someone replies interested, the thread goes to a person.
//   SYZYGY's own pitch → SYZYGY's desk, whose job is to refer the lead to Qloo. The packet carries a
//                        drafted intro note they can forward.
//   signed as a brand  → that brand, on its private workspace page (and its handoff email once mail is live).
// Each handoff gets a private page (/handoff/<token>) with the packet and buttons for what happened next.
// The person is told through HANDOFF_WEBHOOK_URL (Slack or Discord style incoming webhook) if it's set.

import { sql } from "./db";
import { logAction } from "./actions";
import { ask, parseJson } from "./llm";
import { SITE, token } from "./slug";

export type Packet = {
  who: string; role: string; company: string; for_brand: string | null;
  summary: string | null; questions: string[]; answer: string | null;
  thesis: string | null; partner: string | null; numbers: { label: string; value: number }[];
  angle: string | null; account_url: string; reply_url: string;
  next_step: string; intro_note: string | null;
};

const INTRO_SYSTEM = `You write a short handoff note for a person who will take over a sales thread from an AI agent.
Reply with JSON only: {"next_step":"one sentence: what the person should do first","intro_note":"under 110 words"}
If for_brand is null, intro_note is a note the person can forward to Qloo's partnerships team, introducing the lead:
who they are, what they asked, the numbers that got their attention, and that the analysis was built on Qloo's taste
data by SYZYGY (an independent AI sales team, not Qloo), and next_step is about introducing them to Qloo: SYZYGY
itself doesn't sell anything or book meetings. If for_brand is set, intro_note is null and next_step is the brand replying itself.
Use only the facts given. Affinity values are 0 to 1 scores, never percentages. No em dashes, no hype.`;

export const handoffPath = (t: string) => `/handoff/${t}`;

type Row = {
  reply_id: string; reply_slug: string | null; summary: string | null; questions: string[] | null; answer: string | null; simulated: boolean;
  contact_name: string | null; role: string; account_id: string; account_slug: string | null; company: string; evidence: Record<string, unknown>;
  partner: string | null; thesis: string | null; workspace_id: string | null; ws_name: string | null; ws_demo: boolean | null; handoff_email: string | null; angle: string | null;
};

/** Builds the packet, stores the handoff, tells the person. Called by the Inbox agent on an interested reply. */
export async function handOff(replyId: string) {
  const [r] = (await sql()`
    select r.id reply_id, r.slug reply_slug, r.detail->>'summary' summary, r.detail->'questions' questions, r.answer, r.simulated,
      c.name contact_name, c.role, ac.id account_id, ac.slug account_slug, e.name company, ac.evidence, pe.name partner, p.thesis,
      t.workspace_id, wb.name ws_name, w.demo ws_demo, w.handoff_email,
      (select pl.angle from plans pl where pl.id = t.plan_id) angle
    from replies r join touches t on t.id = r.touch_id join contacts c on c.id = t.contact_id
    join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id join pairs p on p.id = ac.pair_id
    left join entities pe on pe.qloo_id = ac.passed_on
    left join workspaces w on w.id = t.workspace_id left join entities wb on wb.qloo_id = w.entity_id
    where r.id = ${replyId}`) as Row[];
  if (!r) throw new Error(`no reply ${replyId}`);
  const existing = (await sql()`select token from handoffs where reply_id = ${replyId}`) as { token: string }[];
  if (existing.length) return { token: existing[0].token, existed: true };

  const pull = (r.evidence.pull ?? {}) as { partnerFansLikeAccount?: number | null; accountFansLikePartner?: number | null };
  const score = (r.evidence.pair as { score?: number } | undefined)?.score;
  const numbers = [
    pull.partnerFansLikeAccount != null && r.partner ? { label: `${r.partner} fans → ${r.company}`, value: +pull.partnerFansLikeAccount.toFixed(2) } : null,
    pull.accountFansLikePartner != null && r.partner ? { label: `${r.company} fans → ${r.partner}`, value: +pull.accountFansLikePartner.toFixed(2) } : null,
    score != null ? { label: "Thesis score", value: +score.toFixed(2) } : null,
  ].filter((x): x is { label: string; value: number } => !!x);
  const who = r.contact_name ?? `${r.company}'s ${r.role}`;
  const forBrand = r.workspace_id ? r.ws_name : null;
  const facts = { who, role: r.role, company: r.company, for_brand: forBrand, their_reply_summary: r.summary, questions: r.questions ?? [], our_answer: r.answer, thesis: r.thesis, numbers, angle: r.angle };
  const llm = await ask("fast", INTRO_SYSTEM, JSON.stringify(facts), 500).catch(() => null);
  const drafted = llm ? parseJson<{ next_step?: string; intro_note?: string | null }>(llm.text) : null;
  const clean = (s: string | null | undefined) => (s && !/—|%/.test(s) ? s : null);

  const packet: Packet = {
    who, role: r.role, company: r.company, for_brand: forBrand,
    summary: r.summary, questions: r.questions ?? [], answer: r.answer,
    thesis: r.thesis, partner: r.partner, numbers, angle: r.angle,
    account_url: `${SITE}/account/${r.account_slug ?? r.account_id}`, reply_url: `${SITE}/reply/${r.reply_slug ?? r.reply_id}`,
    next_step: clean(drafted?.next_step) ?? (forBrand ? `Reply to ${who} yourself and pick up where the agent left off.` : `Read the thread, then introduce ${who} to Qloo's partnerships team.`),
    intro_note: forBrand ? null : clean(drafted?.intro_note),
  };
  const t = token(20);
  const [h] = (await sql()`
    insert into handoffs (reply_id, workspace_id, token, packet, simulated) values (${replyId}, ${r.workspace_id}, ${t}, ${JSON.stringify(packet)}, ${r.simulated})
    on conflict (reply_id) do nothing returning id`) as { id: string }[];
  if (!h) return { token: ((await sql()`select token from handoffs where reply_id = ${replyId}`) as { token: string }[])[0].token, existed: true };

  const notified = await notify(packet, t, r.simulated, r.handoff_email);
  await sql()`update handoffs set notified = ${JSON.stringify(notified)} where id = ${h.id}`;
  const tag = r.simulated ? " (simulated reply)" : "";
  await logAction({
    agent: "inbox", kind: "handoff.sent",
    summary: forBrand
      ? `Handed ${who} at ${r.company} to the brand that claimed its page${tag}. Their thread, their call from here.`
      : `Handed ${who} at ${r.company} to a person${tag}, with the numbers and a drafted intro to Qloo. The agents don't book meetings.`,
    refTable: "replies", refId: replyId, detail: { simulated: r.simulated, handoff: h.id }, llmCostUsd: llm?.costUsd,
  });
  return { token: t, existed: false, notified };
}

/** Tells the person. A webhook if one is set; brand emails wait for the mailbox like everything else. */
async function notify(p: Packet, t: string, simulated: boolean, brandEmail: string | null) {
  const out: Record<string, string> = {};
  const url = process.env.HANDOFF_WEBHOOK_URL?.trim();
  const text = `${simulated ? "[simulated] " : ""}${p.who} (${p.role}) at ${p.company} replied interested${p.for_brand ? ` to a message signed as ${p.for_brand}` : ""}. ${p.summary ?? ""}\n${SITE}${handoffPath(t)}`;
  if (url && !p.for_brand) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(8000) });
      out.webhook = res.ok ? "sent" : `failed ${res.status}`;
    } catch (e) { out.webhook = `failed: ${(e as Error).message.slice(0, 80)}`; }
  } else if (!p.for_brand) out.webhook = "not set";
  if (p.for_brand) out.brand = brandEmail ? "email waits for the mailbox; on their workspace page now" : "on their workspace page";
  return out;
}

export const STATUS = {
  open: "Waiting for a person",
  referred: "Referred to Qloo",
  closed: "Closed",
} as const;

/** What the person did next. Logged to the floor so the trail doesn't stop at "handed off". */
export async function setHandoffStatus(t: string, status: "referred" | "closed" | "open") {
  const [h] = (await sql()`
    update handoffs set status = ${status}, updated_at = now() where token = ${t} and status <> ${status}
    returning id, reply_id, workspace_id, simulated, packet`) as { id: string; reply_id: string; workspace_id: string | null; simulated: boolean; packet: Packet }[];
  if (!h || status === "open") return !!h;
  const tag = h.simulated ? " (simulated reply)" : "";
  await logAction({
    agent: "inbox", kind: `handoff.${status}`,
    summary: status === "referred"
      ? h.workspace_id ? `The brand picked up the ${h.packet.company} thread${tag} itself.` : `A person took the ${h.packet.company} thread${tag} and referred it to Qloo.`
      : `The ${h.packet.company} thread${tag} is closed${h.workspace_id ? " by the brand" : ""}.`,
    refTable: "replies", refId: h.reply_id, detail: { simulated: h.simulated, handoff: h.id },
  });
  return true;
}
