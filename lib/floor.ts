import { sql } from "./db";
import { ROUTE } from "./slug";

export type FeedItem = { id: string; agent: string; kind: string; summary: string; created_at: string; href: string | null };
export type Funnel = { label: string; value: number; agent: string }[];

const SUBPAGE = ROUTE;

// Test replies stay off the public floor until he says they can be shown (SHOW_SIMULATED=1).
export const showSimulated = () => process.env.SHOW_SIMULATED === "1";

export async function feed(limit = 40, after?: string): Promise<FeedItem[]> {
  const rows = (after
    ? await sql()`select id, agent, kind, summary, created_at, ref_table, ref_id from actions where date_trunc('milliseconds', created_at) > ${after}::timestamptz
        and (${showSimulated()} or coalesce(detail->>'simulated', 'false') <> 'true') order by created_at desc limit ${limit}`
    : await sql()`select id, agent, kind, summary, created_at, ref_table, ref_id from actions
        where (${showSimulated()} or coalesce(detail->>'simulated', 'false') <> 'true') order by created_at desc limit ${limit}`
  ) as (FeedItem & { ref_table: string | null; ref_id: string | null })[];
  // Feed lines link to the readable address of whatever they're about.
  const slugs = new Map<string, string>();
  for (const table of new Set(rows.map(r => r.ref_table).filter((t): t is string => !!t && !!SUBPAGE[t]))) {
    const ids = rows.filter(r => r.ref_table === table && r.ref_id).map(r => r.ref_id!);
    for (const x of (await sql().query(`select id::text id, slug from ${table} where id::text = any($1) and slug is not null`, [ids])) as { id: string; slug: string }[])
      slugs.set(`${table}:${x.id}`, x.slug);
  }
  return rows.map(r => ({
    id: r.id, agent: r.agent, kind: r.kind, summary: r.summary,
    created_at: new Date(r.created_at).toISOString(),
    href: r.ref_table && r.ref_id && SUBPAGE[r.ref_table] ? SUBPAGE[r.ref_table] + (slugs.get(`${r.ref_table}:${r.ref_id}`) ?? r.ref_id) : null,
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
