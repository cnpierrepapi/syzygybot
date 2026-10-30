// What /admin reads: every agent step, everything that went wrong, and every desk at a glance. Read-only; nothing here
// changes a card, a send or a desk.
import { sql } from "./db";
import { PERSONAS } from "./personas";

const DAYS = 7;

export type Act = { at: string; agent: string; kind: string; summary: string; persona: string | null; cost: number | null };

/** The action log, newest first, filtered by agent, desk and a word in the summary. */
export async function activity(f: { agent?: string; desk?: string; q?: string; limit?: number }): Promise<Act[]> {
  const agent = f.agent || null, desk = f.desk || null, q = f.q ? `%${f.q.replace(/[%_\\]/g, m => `\\${m}`)}%` : null;
  return (await sql()`select created_at at, agent, kind, summary, detail->>'persona' persona, llm_cost_usd cost from actions
    where created_at <= now() and (${agent}::text is null or agent = ${agent})
      and (${desk}::text is null or detail->>'persona' = ${desk})
      and (${q}::text is null or summary ilike ${q} or kind ilike ${q})
    order by created_at desc limit ${Math.min(f.limit ?? 200, 500)}`) as Act[];
}

export const agentsSeen = async () =>
  ((await sql()`select agent from actions where created_at > now() - interval '30 days' group by agent order by count(*) desc`) as { agent: string }[]).map(r => r.agent);

/** Everything that went wrong in the last week, by where it happened. */
export async function errors() {
  const [failedRuns, dropped, sends, logged, desksCron, mailbox] = await Promise.all([
    sql()`select id, persona, trigger, started_at, error from runs where status = 'failed' and started_at > now() - make_interval(days => ${DAYS})
      order by started_at desc limit 50`,
    sql()`select coalesce(detail->>'why', 'no reason recorded') why, count(*)::int n, max(created_at) last, (array_agg(org order by created_at desc))[1:3] orgs
      from run_cards where status = 'dropped' and created_at > now() - make_interval(days => ${DAYS}) group by 1 order by n desc`,
    sql()`select o.id, o.company, o.channel, o.status, o.created_at, o.detail, r.persona from outbound o join permission_requests r on r.id = o.request_id
      where o.status in ('held','failed','bounced') order by o.created_at desc limit 50`,
    sql()`select created_at at, agent, kind, summary, detail->>'persona' persona from actions
      where created_at > now() - make_interval(days => ${DAYS}) and created_at <= now() and (kind ~ '(fail|error)' or summary ~* '^(the run stopped early|skipped .* lane)')
      order by created_at desc limit 80`,
    sql()`select max(created_at) last from actions where kind = 'desk.run'`,
    sql()`select max(updated_at) last from mailbox_state`,
  ]);
  return {
    failedRuns: failedRuns as { id: string; persona: string; trigger: string; started_at: string; error: string | null }[],
    dropped: dropped as { why: string; n: number; last: string; orgs: string[] }[],
    sends: sends as { id: string; company: string; channel: string; status: string; created_at: string; detail: Record<string, unknown>; persona: string }[],
    logged: logged as Omit<Act, "cost">[],
    crons: [
      // The desks cron fires at :05 and :35; a gap over an hour means it missed twice.
      { name: "Desks (every 30 min)", last: (desksCron as { last: string | null }[])[0]?.last ?? null, lateAfterMin: 65 },
      // The mailbox row only moves when the mail cron reads new mail, so a quiet inbox looks old here without anything being wrong.
      { name: "Mailbox read (mail cron, every 15 min; moves only on new mail)", last: (mailbox as { last: string | null }[])[0]?.last ?? null, lateAfterMin: null },
    ],
  };
}

export type DeskRow = {
  id: string; title: string; kind: string; runs: number; lastRun: string | null; lastStatus: string | null;
  cards: number; approved: number; rejected: number; sent: number; held: number; replies: number; owners: number;
};

/** Every desk, built-in and set up, with what's happened on it. */
export async function desks(q?: string): Promise<DeskRow[]> {
  const [custom, runs, cards, decisions, sends, replies, owners] = await Promise.all([
    sql()`select id, name, type from custom_desks`,
    sql()`select distinct on (persona) persona, count(*) over (partition by persona)::int n, started_at, status from runs order by persona, started_at desc`,
    sql()`select persona, count(*)::int n from permission_requests group by 1`,
    sql()`select r.persona, d.decision, count(*)::int n from request_decisions d join permission_requests r on r.id = d.request_id group by 1, 2`,
    sql()`select r.persona, o.status, count(*)::int n from outbound o join permission_requests r on r.id = o.request_id group by 1, 2`,
    sql()`select r.persona, count(*)::int n from outbound_replies x join outbound o on o.id = x.outbound_id join permission_requests r on r.id = o.request_id group by 1`,
    sql()`select persona, count(*)::int n from desk_owners group by 1`,
  ]) as [{ id: string; name: string; type: string }[], { persona: string; n: number; started_at: string; status: string }[], { persona: string; n: number }[],
    { persona: string; decision: string; n: number }[], { persona: string; status: string; n: number }[], { persona: string; n: number }[], { persona: string; n: number }[]];
  const n = <T extends { persona: string; n: number }>(xs: T[], id: string, f: (x: T) => boolean = () => true) =>
    xs.filter(x => x.persona === id && f(x)).reduce((s, x) => s + x.n, 0);
  const all = [
    ...PERSONAS.map(p => ({ id: p.id, title: p.title, kind: p.judge ? `written for: ${p.subject}` : p.demo ? "demo" : "built in" })),
    ...custom.map(c => ({ id: c.id, title: `${c.name}${/s$/i.test(c.name) ? "'" : "'s"} desk`, kind: c.type === "business" ? "set up from a website" : `set up: ${c.type.replace("_", " ")}` })),
  ];
  const needle = q?.trim().toLowerCase();
  return all.filter(d => !needle || d.title.toLowerCase().includes(needle) || d.id.includes(needle)).map(d => {
    const r = runs.find(x => x.persona === d.id);
    return {
      ...d, runs: r?.n ?? 0, lastRun: r?.started_at ?? null, lastStatus: r?.status ?? null,
      cards: n(cards, d.id), approved: n(decisions, d.id, x => x.decision === "approved"), rejected: n(decisions, d.id, x => x.decision === "rejected"),
      sent: n(sends, d.id, x => x.status === "sent"), held: n(sends, d.id, x => x.status === "held" || x.status === "failed"),
      replies: n(replies, d.id), owners: n(owners, d.id),
    };
  }).sort((a, b) => +new Date(b.lastRun ?? 0) - +new Date(a.lastRun ?? 0));
}

/** One desk in full: its runs, cards, real sends, replies and who verified it. */
export async function desk(id: string) {
  const [runs, cards, sends, replies, owners] = await Promise.all([
    sql()`select id, trigger, status, started_at, finished_at, qloo_calls, cost_usd, error,
      (select count(*)::int from run_cards c where c.run_id = runs.id and c.status = 'done') filed,
      (select count(*)::int from run_cards c where c.run_id = runs.id and c.status = 'dropped') dropped
      from runs where persona = ${id} order by started_at desc limit 12`,
    sql()`select r.id, r.title, r.slug, r.target->>'org' org, r.target->>'channel' channel, r.target->>'address' address, r.clearance->>'status' clearance,
      r.created_at, coalesce(json_agg(json_build_object('decision', d.decision, 'reason', d.reason, 'at', d.decided_at)) filter (where d.decision is not null), '[]') decisions
      from permission_requests r left join request_decisions d on d.request_id = r.id where r.persona = ${id}
      group by r.id order by r.created_at desc limit 40`,
    sql()`select o.company, o.channel, o.status, o.to_address, o.scheduled_for, o.sent_at, o.created_at, o.detail from outbound o
      join permission_requests r on r.id = o.request_id where r.persona = ${id} order by o.created_at desc limit 30`,
    sql()`select x.class, x.summary, x.created_at, o.company from outbound_replies x join outbound o on o.id = x.outbound_id
      join permission_requests r on r.id = o.request_id where r.persona = ${id} order by x.created_at desc limit 30`,
    sql()`select email, verified_at from desk_owners where persona = ${id} order by verified_at desc`,
  ]);
  return {
    runs: runs as { id: string; trigger: string; status: string; started_at: string; finished_at: string | null; qloo_calls: number; cost_usd: number; error: string | null; filed: number; dropped: number }[],
    cards: cards as { id: string; title: string; slug: string | null; org: string; channel: string; address: string | null; clearance: string; created_at: string; decisions: { decision: string; reason: string | null; at: string }[] }[],
    sends: sends as { company: string; channel: string; status: string; to_address: string | null; scheduled_for: string | null; sent_at: string | null; created_at: string; detail: Record<string, unknown> }[],
    replies: replies as { class: string; summary: string | null; created_at: string; company: string }[],
    owners: owners as { email: string; verified_at: string }[],
  };
}
