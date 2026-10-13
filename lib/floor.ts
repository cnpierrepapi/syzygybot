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
export type Funnel = { label: string; value: number; agent: string }[];

const SUBPAGE = ROUTE;

// Test replies stay off the public floor until he says they can be shown (SHOW_SIMULATED=1).
export const showSimulated = () => process.env.SHOW_SIMULATED === "1";

export async function feed(limit = 40, after?: string): Promise<FeedItem[]> {
  const rows = (after
    ? await sql()`select id, agent, kind, summary, created_at, ref_table, ref_id, detail->>'entity_id' seed from actions where date_trunc('milliseconds', created_at) > ${after}::timestamptz
        and (${showSimulated()} or coalesce(detail->>'simulated', 'false') <> 'true') order by created_at desc limit ${limit}`
    : await sql()`select id, agent, kind, summary, created_at, ref_table, ref_id, detail->>'entity_id' seed from actions
        where (${showSimulated()} or coalesce(detail->>'simulated', 'false') <> 'true') order by created_at desc limit ${limit}`
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
      (select count(*) from pairs)::int pairs,
      (select count(*) from pairs where band in ('WATCH','PITCH'))::int theses,
      (select count(*) from pairs where band = 'PITCH')::int pitch,
      (select count(*) from accounts)::int accounts,
      (select count(*) from contacts)::int contacts,
      (select count(*) from contacts where role_status = 'confirmed')::int verified,
      (select count(*) from touches where step = 1)::int touches,
      (select count(*) from touches where scheduled_for is not null and status <> 'cancelled')::int scheduled,
      (select count(*) from replies where ${showSimulated()} or not simulated)::int replies,
      (select count(*) from do_not_contact)::int optouts`) as Record<string, number>[];
  return [
    { label: "Pairs researched", value: c.pairs, agent: "scout" },
    { label: "Theses published", value: c.theses, agent: "scout" },
    { label: "PITCH grade", value: c.pitch, agent: "scout" },
    { label: "Accounts qualified", value: c.accounts, agent: "qualifier" },
    { label: "Contacts found", value: c.contacts, agent: "contact_finder" },
    { label: "Verified", value: c.verified, agent: "verifier" },
    { label: "Messages drafted", value: c.touches, agent: "writer" },
    { label: "Steps scheduled", value: c.scheduled, agent: "sequencer" },
    { label: "Replies", value: c.replies, agent: "inbox" },
    { label: "Opt-outs honoured", value: c.optouts, agent: "inbox" },
  ];
}
