// The desk board: every permission request is a card, and its columns are the agents' steps. A card's history comes
// from the action log (real times, real summaries), so the board can replay how the agents carried it across; where it
// sits now comes from its state (Clearance, the decision, the message's status, replies). People never move cards.
import { sql } from "./db";
import { persona } from "./personas";
import type { Request } from "./desk";

export const COLUMNS = [
  { id: "spotted", label: "Spotted", agents: "Scout" },
  { id: "checked", label: "Checked", agents: "Deal check, Numbers" },
  { id: "person", label: "Person found", agents: "Contact finder, Verifier" },
  { id: "drafted", label: "Drafted", agents: "Writer" },
  { id: "clearance", label: "Clearance", agents: "Clearance" },
  { id: "approval", label: "Your approval", agents: "You" },
  { id: "sending", label: "Sending", agents: "Sequencer" },
  { id: "sent", label: "Sent", agents: "Sequencer" },
  { id: "replied", label: "Replied", agents: "Inbox agent" },
] as const;
export type ColumnId = (typeof COLUMNS)[number]["id"];
const COL = Object.fromEntries(COLUMNS.map((c, i) => [c.id, i])) as Record<ColumnId, number>;

export type Step = { col: number; agent: string; kind: string; at: string; summary: string };
export type BoardCard = {
  id: string; title: string; desk: string; org: string; person: string | null; channel: string; real: boolean;
  col: number; note: string | null; steps: Step[]; recorded: string; decision: Request["decision"];
};

// Where a log entry belongs on the board.
function columnOf(agent: string, kind: string): number | null {
  if (kind === "step.matched" || agent === "scout") return COL.spotted;
  if (["checker", "qualifier", "numbers"].includes(agent)) return COL.checked;
  if (kind === "step.buyer" || agent === "contact_finder" || agent === "verifier") return COL.person;
  if (agent === "clearance") return COL.clearance;
  if (kind === "touch.approved" || /^request\.approved/.test(kind)) return COL.sending;
  if (kind === "touch.sent" || kind === "letter.sent" || kind === "letter.test") return COL.sent;
  if (agent === "inbox") return COL.replied;
  if (["strategist", "writer"].includes(agent) || kind === "request.drafted" || kind === "sequence.scheduled") return COL.drafted;
  return null;
}

type Row = { ref_table: string; ref_id: string; agent: string; kind: string; summary: string; created_at: string };

/** Board cards for a persona, from this workspace's point of view. */
export async function board(reqs: Request[]): Promise<BoardCard[]> {
  if (!reqs.length) return [];
  const ids = reqs.map(r => r.id);
  // Sales and pitches cards stand on a message the ten-agent chain wrote: trace it back to its pair.
  const chains = (await sql()`
    select r.id req, t.id touch, t.status touch_status, c.id contact, ac.id account, ac.pair_id pair, t.plan_id plan,
      (select count(*)::int from replies x where x.touch_id = t.id and not x.simulated) replies
    from permission_requests r join touches t on r.ref_table = 'touches' and t.id::text = r.ref_id
    join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id
    where r.id = any(${ids})`) as { req: string; touch: string; touch_status: string; contact: string; account: string; pair: string; plan: string | null; replies: number }[];
  const chainOf = new Map(chains.map(c => [c.req, c]));
  const refs = [...new Set(chains.flatMap(c => [c.touch, c.contact, c.account, c.pair, c.plan].filter(Boolean) as string[]).concat(ids))];
  const log = (await sql()`
    select ref_table, ref_id, agent, kind, summary, created_at from actions
    where ref_id = any(${refs}) and kind not in ('touch.dry_run', 'desk.run') order by created_at`) as Row[];
  const byRef = new Map<string, Row[]>();
  for (const a of log) { const k = `${a.ref_table}:${a.ref_id}`; (byRef.get(k) ?? byRef.set(k, []).get(k)!).push(a); }
  const at = (table: string, id: string | null | undefined) => (id ? byRef.get(`${table}:${id}`) ?? [] : []);

  return reqs.map(r => {
    const ch = chainOf.get(r.id);
    const rows = [
      ...(ch ? [...at("pairs", ch.pair), ...at("accounts", ch.account), ...at("contacts", ch.contact), ...at("plans", ch.plan), ...at("touches", ch.touch)] : []),
      ...at("permission_requests", r.id).filter(a => !/^request\.(approved|rejected|held)$/.test(a.kind)),
    ];
    const steps = rows.map(a => ({ col: columnOf(a.agent, a.kind), agent: a.agent, kind: a.kind, at: a.created_at, summary: a.summary }))
      .filter((s): s is Step => s.col != null)
      .sort((a, b) => +new Date(a.at) - +new Date(b.at));
    const real = !!persona(r.persona)?.realSends && r.desk === "pitches" && r.target.channel === "email";
    // Where it is now.
    let col: number = r.clearance.status === "hold" ? COL.clearance : COL.approval, note: string | null = null;
    if (r.decision === "rejected") note = "Rejected";
    else if (r.decision === "held") note = "On hold";
    else if (r.decision === "approved") {
      if (real && ch) {
        col = ch.replies ? COL.replied : ch.touch_status === "sent" ? COL.sent : COL.sending;
        note = ch.touch_status === "sent" ? "Sent for real" : "Approved, waiting for their sending window";
      } else { col = COL.sent; note = "Simulated: nothing was sent"; }
    } else if (ch?.touch_status === "sent") { col = ch.replies ? COL.replied : COL.sent; note = "Sent on an earlier approval"; }
    else if (ch?.touch_status === "queued") { col = COL.sending; note = "Approved, waiting for their sending window"; }
    if (r.clearance.status === "hold" && !r.decision) note = "Held by Clearance";
    return {
      id: r.id, title: r.title, desk: r.desk, org: r.target.org, person: r.target.person ?? null, channel: r.target.channel, real,
      col, note, steps, recorded: (steps[0]?.at ?? r.created_at), decision: r.decision,
    };
  });
}
