import { sql } from "./db";

export type FeedItem = { id: string; agent: string; kind: string; summary: string; created_at: string; href: string | null };
export type Funnel = { label: string; value: number; agent: string }[];

const SUBPAGE: Record<string, string> = { pairs: "/thesis/", accounts: "/account/" };

export async function feed(limit = 40, after?: string): Promise<FeedItem[]> {
  const rows = (after
    ? await sql()`select id, agent, kind, summary, created_at, ref_table, ref_id from actions where created_at > ${after} order by created_at desc limit ${limit}`
    : await sql()`select id, agent, kind, summary, created_at, ref_table, ref_id from actions order by created_at desc limit ${limit}`
  ) as (FeedItem & { ref_table: string | null; ref_id: string | null })[];
  return rows.map(r => ({
    id: r.id, agent: r.agent, kind: r.kind, summary: r.summary,
    created_at: new Date(r.created_at).toISOString(),
    href: r.ref_table && r.ref_id && SUBPAGE[r.ref_table] ? SUBPAGE[r.ref_table] + r.ref_id : null,
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
      (select count(*) from contacts where email_status = 'valid')::int verified,
      (select count(*) from touches)::int touches,
      (select count(*) from replies)::int replies`) as Record<string, number>[];
  return [
    { label: "Pairs researched", value: c.pairs, agent: "scout" },
    { label: "Theses published", value: c.theses, agent: "scout" },
    { label: "PITCH grade", value: c.pitch, agent: "scout" },
    { label: "Accounts qualified", value: c.accounts, agent: "qualifier" },
    { label: "Contacts found", value: c.contacts, agent: "contact_finder" },
    { label: "Verified", value: c.verified, agent: "verifier" },
    { label: "Touches", value: c.touches, agent: "writer" },
    { label: "Replies", value: c.replies, agent: "inbox" },
  ];
}
