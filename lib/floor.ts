import { sql } from "./db";
import { ROUTE } from "./slug";

// `stars` are the Qloo ids of the entities an action touched; the constellation sends its pulse there.
export type FeedItem = { id: string; agent: string; kind: string; summary: string; created_at: string; href: string | null; stars: string[] };

// Which entities a row in each table is about.
const STARS_SQL: Record<string, string> = {
  pairs: `select id::text id, slug, array[a_id, b_id] stars from pairs where id::text = any($1)`,
  accounts: `select id::text id, slug, array[entity_id] stars from accounts where id::text = any($1)`,
  plans: `select pl.id::text id, pl.slug, array[ac.entity_id] stars from plans pl join accounts ac on ac.id = pl.account_id where pl.id::text = any($1)`,
  contacts: `select c.id::text id, c.slug, array[ac.entity_id] stars from contacts c join accounts ac on ac.id = c.account_id where c.id::text = any($1)`,
  touches: `select t.id::text id, t.slug, array[ac.entity_id] stars from touches t join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id where t.id::text = any($1)`,
  replies: `select r.id::text id, r.slug, array[ac.entity_id] stars from replies r join touches t on t.id = r.touch_id join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id where r.id::text = any($1)`,
};
export type Funnel = { label: string; value: number; agent: string; href: string }[];

const SUBPAGE = ROUTE;

// Kept off the live floor: the intake's per-seed bookkeeping, and the Verifier correcting records it already
// holds (a fixed title, a restored contact, a recheck finding someone left). The floor shows the team working.
const OFF_FLOOR = ["queue.scored", "contact.relabelled", "contact.restored", "desk.run"];

// Only what happens inside the persona desks reaches the floor (his call, 23 Oct): live runs and desk decisions.
// Test replies stay off the public floor until he says they can be shown (SHOW_SIMULATED=1).
export const showSimulated = () => process.env.SHOW_SIMULATED === "1";

export async function feed(limit = 40, after?: string): Promise<FeedItem[]> {
  const rows = (after
    ? await sql()`select id, agent, kind, summary, created_at, ref_table, ref_id, detail->>'entity_id' seed from actions where date_trunc('milliseconds', created_at) > ${after}::timestamptz
        and (${showSimulated()} or coalesce(detail->>'simulated', 'false') <> 'true') and not (kind = any(${OFF_FLOOR})) and coalesce(detail->>'correction', 'false') <> 'true' and (detail ? 'run' or detail ? 'workspace') order by created_at desc limit ${limit}`
    : await sql()`select id, agent, kind, summary, created_at, ref_table, ref_id, detail->>'entity_id' seed from actions
        where (${showSimulated()} or coalesce(detail->>'simulated', 'false') <> 'true') and not (kind = any(${OFF_FLOOR})) and coalesce(detail->>'correction', 'false') <> 'true' and (detail ? 'run' or detail ? 'workspace') order by created_at desc limit ${limit}`
  ) as (FeedItem & { ref_table: string | null; ref_id: string | null; seed: string | null })[];
  // Feed lines link to the readable address of whatever they're about.
  const slugs = new Map<string, string>(), stars = new Map<string, string[]>();
  for (const table of new Set(rows.map(r => r.ref_table).filter((t): t is string => !!t && !!STARS_SQL[t]))) {
    const ids = rows.filter(r => r.ref_table === table && r.ref_id).map(r => r.ref_id!);
    for (const x of (await sql().query(STARS_SQL[table], [ids])) as { id: string; slug: string | null; stars: string[] }[]) {
      if (x.slug) slugs.set(`${table}:${x.id}`, x.slug);
      stars.set(`${table}:${x.id}`, x.stars);
    }
  }
  return rows.map(r => ({
    id: r.id, agent: r.agent, kind: r.kind, summary: r.summary,
    created_at: new Date(r.created_at).toISOString(),
    href: r.ref_table && r.ref_id && SUBPAGE[r.ref_table] ? SUBPAGE[r.ref_table] + (slugs.get(`${r.ref_table}:${r.ref_id}`) ?? r.ref_id) : null,
    stars: stars.get(`${r.ref_table}:${r.ref_id}`) ?? (r.seed ? [r.seed] : []),
  }));
}

export async function funnel(): Promise<Funnel> {
  const [c] = (await sql()`
    select
      (select count(*) from runs where status = 'done')::int runs,
      (select count(*) from estimate_checks where source = 'run')::int measured,
      (select count(*) from permission_requests where run_id is not null)::int filed,
      (select count(*) from pairs)::int pairs,
      (select count(*) from pairs where band in ('WATCH','PITCH'))::int theses,
      (select count(*) from pairs where band = 'PITCH')::int pitch,
      (select count(*) from accounts)::int accounts,
      (select count(*) from contacts)::int contacts,
      (select count(*) from contacts where role_status = 'confirmed')::int verified,
      (select count(*) from touches where step = 1)::int touches,
      (select count(*) from touches where scheduled_for is not null and status <> 'cancelled')::int scheduled,
      (select count(*) from replies where ${showSimulated()} or not simulated)::int replies,
      (select count(*) from do_not_contact)::int optouts,
      (select count(*) from handoffs where ${showSimulated()} or not simulated)::int handoffs,
      (select count(*) from workspaces where claimed_at is not null and not demo)::int claimed`) as Record<string, number>[];
  return [
    // The desks' live runs lead; the queue chain behind the older tiles stopped on 23 Oct, so its backlog isn't shown.
    { label: "Live desk runs", value: c.runs, agent: "scout", href: "/desk" },
    { label: "Brands measured both ways", value: c.measured, agent: "numbers", href: "/desk" },
    { label: "Cards filed by runs", value: c.filed, agent: "clearance", href: "/desk" },
    { label: "Theses published", value: c.theses, agent: "scout", href: "/floor/theses" },
    { label: "PITCH grade", value: c.pitch, agent: "scout", href: "/floor/pitch" },
    { label: "Accounts qualified", value: c.accounts, agent: "numbers", href: "/floor/accounts" },
    { label: "Contacts found", value: c.contacts, agent: "contact_finder", href: "/floor/contacts" },
    { label: "Verified", value: c.verified, agent: "verifier", href: "/floor/verified" },
    { label: "Messages drafted", value: c.touches, agent: "writer", href: "/floor/messages" },
    { label: "Steps scheduled", value: c.scheduled, agent: "sequencer", href: "/floor/scheduled" },
    { label: "Replies", value: c.replies, agent: "inbox", href: "/floor/replies" },
    { label: "Opt-outs honoured", value: c.optouts, agent: "inbox", href: "/floor/opt-outs" },
    { label: "Handed to a person", value: c.handoffs, agent: "inbox", href: "/floor/handoffs" },
    { label: "Brands claimed", value: c.claimed, agent: "verifier", href: "/floor/claimed" },
  ];
}
