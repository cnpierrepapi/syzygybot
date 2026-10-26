// The dashboard's server side: a visitor's demo workspace, the permission requests their persona's desks produced, and
// what they decided. Demo workspaces are throwaway and capped; approving in one runs a simulated execution, never a send.
import { sql } from "./db";
import { logAction, type Agent } from "./actions";
import { token } from "./slug";
import { clear, DEFAULT_RULES, type Check, type Clearance, type Rules } from "./clearance";
import { persona, type DeskId, type Persona } from "./personas";
import { approveAndSend } from "./mail";
import { approveReal, cancelReal } from "./outbound";
import { ownerOf } from "./owners";

export const DESK_COOKIE = "syz_desk";
const DAILY_DEMOS = 400;

export type Request = {
  id: string; persona: string; desk: DeskId; action: string; title: string; slug: string | null; ref_table?: string | null;
  target: { org: string; person?: string | null; role?: string | null; address?: string | null; source?: string | null; postal?: string | null; channel: "email" | "letter"; country: string };
  preview: { subject: string; body: string };
  evidence: { match?: { score: number; strength: string; qloo: { toward: number; back: number; band: string; via?: string[] } | null; sharedTags: string[]; sharedCities: string[] } | null; pattern?: { strength: string; lookalikes: string[] } | null; facts: string[] };
  clearance: Clearance;
  created_at: string;
  decision: "approved" | "rejected" | "held" | null; reason: string | null; edited: { subject: string; body: string } | null; outcome: Record<string, unknown> | null; decided_at: string | null;
};

export type Workspace = { id: string; persona: string | null; detail: { rules?: Partial<Rules> } };

export async function workspace(id: string | undefined): Promise<Workspace | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [w] = (await sql()`select id, persona, detail from workspaces where id = ${id} and demo`) as Workspace[];
  return w ?? null;
}

/** A new throwaway workspace for this browser, or the one it already has, switched to this persona. */
export async function openDesk(p: Persona, existing?: string) {
  const w = await workspace(existing);
  if (w) {
    await sql()`update workspaces set persona = ${p.id}, name = ${p.title} where id = ${w.id}`;
    return { ok: true as const, id: w.id };
  }
  const [{ n }] = (await sql()`select count(*)::int n from workspaces where demo and created_at > now() - interval '1 day'`) as { n: number }[];
  if (n >= DAILY_DEMOS) return { ok: false as const, why: "Today's demo desks are all taken. Try again tomorrow." };
  const [row] = (await sql()`insert into workspaces (entity_id, name, connect_token, demo, persona, detail)
    values (null, ${p.title}, ${token(16)}, true, ${p.id}, '{}') returning id`) as { id: string }[];
  return { ok: true as const, id: row.id };
}

export const rulesOf = (w: Workspace | null): Rules => ({ ...DEFAULT_RULES, ...(w?.detail?.rules ?? {}) });

/** Clearance under this workspace's rules: a rule switched off no longer holds anything. */
export function underRules(c: Clearance, rules: Rules): Clearance & { off: Check[] } {
  const on = c.checks.filter(x => x.rule === "data" || rules[x.rule as keyof Rules] !== false);
  const off = c.checks.filter(x => !on.includes(x));
  return { ...c, checks: on, off, status: on.every(x => x.pass) ? "pass" : "hold" };
}

export async function requests(personaId: string | "all", wsId: string | null) {
  return (await sql()`
    select r.id, r.persona, r.desk, r.action, r.title, r.slug, r.ref_table, r.target, r.preview, r.evidence, r.clearance, r.created_at,
      d.decision, d.reason, d.edited, d.outcome, d.decided_at
    from permission_requests r left join request_decisions d on d.request_id = r.id and d.workspace_id = ${wsId}
    where (${personaId} = 'all' or r.persona = ${personaId})
    order by r.created_at desc limit 200`) as Request[];
}

export async function watchItems(personaId: string, limit = 12) {
  return (await sql()`select id, headline, url, source, published, why, move, desk, created_at from watch_items where persona = ${personaId}
    order by coalesce(published, created_at::date) desc, created_at desc limit ${limit}`) as
    { id: string; headline: string; url: string; source: string; published: string | null; why: string; move: string | null; desk: string | null; created_at: string }[];
}

const AGENT_OF: Record<string, Agent> = { pitches: "sequencer", tour: "sequencer", sponsorship: "scout", talent: "scout", venue: "scout", podcast: "scout", sales: "sequencer" };

/** Approve, reject (a reason the agent keeps) or hold. On a desk this workspace has verified as its own (lib/owners.ts),
 * approving sends the card for real, in the desk's name; anywhere else it runs as a simulation. */
export async function decide(w: Workspace, requestId: string, decision: "approved" | "rejected" | "held", reason: string | null, edit: { subject: string; body: string } | null) {
  const [r] = (await sql()`select * from permission_requests where id = ${requestId}`) as (Omit<Request, "decision"> & { persona: string })[];
  if (!r) return { ok: false as const, why: "That request is gone." };
  let clearance = r.clearance;
  if (edit) {
    // An edited message goes back through Clearance before it can be approved.
    clearance = await clear({
      channel: r.target.channel, subject: edit.subject, body: edit.body, address: r.target.address ?? null,
      addressSource: r.target.address ? "published" : null, country: r.target.country,
      talent: [], usesQloo: !!r.evidence.match?.qloo,
    });
  }
  const effective = underRules(clearance, rulesOf(w));
  if (decision === "approved" && effective.status === "hold")
    return { ok: false as const, why: `Clearance is holding this: ${effective.checks.filter(c => !c.pass).map(c => c.label.toLowerCase()).join(", ")}. Fix it or clear the rule first.` };
  const p0 = persona(r.persona);
  // The pitches desk of a real-send persona: an approved email really goes out, through every send gate with Clearance's
  // full default rules (a workspace's switched-off rules don't apply to a real send). Letters stay simulated.
  const owner = !!(await ownerOf(w.id, r.persona));
  const real = owner && !!p0?.realSends && r.desk === "pitches" && (r as { ref_table?: string }).ref_table === "touches" && r.target.channel === "email";
  const liveCard = owner && (r as { ref_table?: string }).ref_table === "run_cards" && (r.target.channel === "email" || r.target.channel === "letter");
  if (real && edit) return { ok: false as const, why: "This one sends for real, so it goes out exactly as SYZYGY wrote it. Approve it as is, or hold it." };
  let realOutcome: Record<string, unknown> | null = null;
  if (real) {
    const touchId = (r as { ref_id?: string }).ref_id!;
    const [t] = (await sql()`select status, sent_at, scheduled_for, detail->>'tz' tz from touches where id = ${touchId}`) as { status: string; sent_at: string | null; scheduled_for: string | null; tz: string | null }[];
    if (decision === "approved") {
      if (t?.status === "sent") realOutcome = { simulated: false, at: t.sent_at, did: `Already sent to ${r.target.org} on an earlier approval.` };
      else {
        const res = await approveAndSend(touchId, `desk:${w.id}`);
        const [after] = (await sql()`select status, sent_at, scheduled_for from touches where id = ${touchId}`) as { status: string; sent_at: string | null; scheduled_for: string | null }[];
        if (after?.status === "sent") realOutcome = { simulated: false, at: after.sent_at, did: `Sent to ${r.target.org}${r.target.person ? ` for ${r.target.person}` : ""}. A real email, now in their inbox.` };
        else if (after?.status === "queued") {
          const when = after.scheduled_for ? new Intl.DateTimeFormat("en-GB", { timeZone: t?.tz ?? "America/New_York", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(after.scheduled_for)) : "the next window";
          realOutcome = { simulated: false, queued: true, did: `Approved for real. It sends ${when} their time, when their sending window opens.` };
        } else return { ok: false as const, why: res.why ?? "It couldn't be sent." };
      }
    } else if (t?.status === "queued") {
      // Taking an approval back before it went out.
      // Only the workspace that approved it can take it back.
      await sql()`update touches set status = 'dry_run', detail = detail - 'approved'
        where id = ${touchId} and status = 'queued' and detail->'approved'->>'by' = ${`desk:${w.id}`}`;
    }
  }
  if (liveCard) {
    if (decision === "approved") {
      // The exact text on the card: this workspace's saved edit if there is one, else the draft.
      const [prev] = (await sql()`select edited from request_decisions where workspace_id = ${w.id} and request_id = ${requestId}`) as { edited: { subject: string; body: string } | null }[];
      const res = await approveReal(requestId, edit ?? prev?.edited ?? r.preview, `owner:${w.id}`);
      if (!res.ok) return { ok: false as const, why: res.why };
      realOutcome = { simulated: false, queued: res.status !== "sent", at: new Date().toISOString(), did: res.did };
    } else await cancelReal(requestId);
  }
  const outcome = realOutcome ?? (decision === "approved" ? {
    simulated: true, at: new Date().toISOString(),
    did: r.target.channel === "email" ? `Queued the email to ${r.target.org}'s published inbox for the next sending window.` : `Queued a printed letter to ${r.target.org}${r.target.postal ? ` (${r.target.postal})` : ""}.`,
    note: "Demo workspace: nothing was sent.",
  } : {});
  await sql()`insert into request_decisions (workspace_id, request_id, decision, reason, edited, outcome)
    values (${w.id}, ${requestId}, ${decision}, ${reason}, ${edit ? JSON.stringify(edit) : null}, ${JSON.stringify(outcome)})
    on conflict (workspace_id, request_id) do update set decision = excluded.decision, reason = excluded.reason,
      edited = coalesce(excluded.edited, request_decisions.edited), outcome = excluded.outcome, decided_at = now()`;
  const p = persona(r.persona);
  await logAction({
    agent: AGENT_OF[r.desk] ?? "sequencer", kind: `request.${decision}`,
    summary: decision === "approved" ? `${p?.title ?? "A desk"} approved "${r.title}"; ${realOutcome ? (realOutcome.did as string) : "ran it as a simulation."}`
      : decision === "rejected" ? `${p?.title ?? "A desk"} rejected "${r.title}"${reason ? `: ${reason}` : ""}. The agent keeps the reason.`
      : `${p?.title ?? "A desk"} put "${r.title}" on hold.`,
    refTable: "permission_requests", refId: requestId, detail: { simulated: !realOutcome, workspace: w.id, reason },
  });
  return { ok: true as const };
}

export async function saveRules(w: Workspace, rules: Partial<Rules>) {
  await sql()`update workspaces set detail = jsonb_set(coalesce(detail, '{}'), '{rules}', ${JSON.stringify(rules)}::jsonb) where id = ${w.id}`;
}

/** Reasons people gave for rejecting a desk's drafts: the desk reads these before it writes again. */
export async function rejectionNotes(personaId: string, desk: string, limit = 5) {
  return ((await sql()`select d.reason from request_decisions d join permission_requests r on r.id = d.request_id
    where r.persona = ${personaId} and r.desk = ${desk} and d.decision = 'rejected' and d.reason is not null
    order by d.decided_at desc limit ${limit}`) as { reason: string }[]).map(x => x.reason);
}
