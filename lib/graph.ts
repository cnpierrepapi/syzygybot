// The constellation: every entity in a published thesis is a star, every thesis is a line between two
// stars, and accounts (the companies the agents are working) are the bright ones.

import { sql } from "./db";

export type Star = { id: string; name: string; type: string; account: boolean; degree: number; href: string };
export type Arc = { a: string; b: string; band: string; score: number; href: string };
export type Graph = { stars: Star[]; arcs: Arc[] };

const MAX_ARCS = 220;

export async function graph(): Promise<Graph> {
  const pairs = (await sql()`
    select p.id, p.slug, p.a_id, p.b_id, p.band, p.score from pairs p
    where p.band in ('PITCH','WATCH') and p.thesis is not null
    order by p.called_at desc limit ${MAX_ARCS}`) as { id: string; slug: string | null; a_id: string; b_id: string; band: string; score: number }[];
  const ids = [...new Set(pairs.flatMap(p => [p.a_id, p.b_id]))];
  const ents = (await sql()`
    select e.qloo_id, e.name, e.type, ac.slug account_slug, ac.id account_id
    from entities e left join lateral (select slug, id from accounts where entity_id = e.qloo_id order by created_at limit 1) ac on true
    where e.qloo_id = any(${ids})`) as { qloo_id: string; name: string; type: string; account_slug: string | null; account_id: string | null }[];

  // The same pair scored under two rubric versions is one line.
  const seen = new Set<string>();
  const arcs: Arc[] = [];
  for (const p of pairs) {
    const k = [p.a_id, p.b_id].sort().join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    arcs.push({ a: p.a_id, b: p.b_id, band: p.band, score: Number(p.score), href: `/thesis/${p.slug ?? p.id}` });
  }
  const degree = new Map<string, number>();
  for (const a of arcs) for (const x of [a.a, a.b]) degree.set(x, (degree.get(x) ?? 0) + 1);
  const firstArc = new Map<string, string>();
  for (const a of arcs) for (const x of [a.a, a.b]) if (!firstArc.has(x)) firstArc.set(x, a.href);

  const stars: Star[] = ents.map(e => ({
    id: e.qloo_id, name: e.name, type: e.type, account: !!e.account_id, degree: degree.get(e.qloo_id) ?? 1,
    href: e.account_id ? `/account/${e.account_slug ?? e.account_id}` : firstArc.get(e.qloo_id) ?? "/",
  }));
  return { stars, arcs };
}
