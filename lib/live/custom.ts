// "Find yours" on /desk: a visitor types a brand, artist, person, show or podcast, picks Qloo's record of it, and gets a desk
// whose live run reads that audience. Searches are cached a week and capped per day, so the page can't drain the quota.
import { sql } from "../db";
import { qloo, type QlooEntity } from "../qloo";
import { slugify, token } from "../slug";
import type { CustomEntity } from "../personas";
import { cached } from "./qx";

const TYPES: CustomEntity["type"][] = ["brand", "artist", "person", "tv_show", "movie", "podcast"];
const SEARCHES_PER_DAY = 300, DESKS_PER_DAY = 60;

export type Found = CustomEntity & { about: string | null };

/** Qloo's records matching a name, the kinds a desk can work for. Null when today's searches are used up. */
export async function find(q: string): Promise<Found[] | null> {
  const query = q.trim().replace(/\s+/g, " ").slice(0, 60);
  if (query.length < 2) return [];
  const key = `find:${query.toLowerCase()}`;
  const [hit] = (await sql()`select 1 from qloo_cache where key = ${key} and fetched_at > now() - interval '7 days'`) as unknown[];
  if (!hit) {
    const [{ n }] = (await sql()`select count(*)::int n from qloo_cache where key like 'find:%' and fetched_at > now() - interval '1 day'`) as { n: number }[];
    if (n >= SEARCHES_PER_DAY) return null;
  }
  return cached(key, 7, async () => {
    const r = await qloo<{ results?: QlooEntity[] }>("/search", { query, take: 12 });
    return (r.results ?? []).flatMap(e => {
      const type = TYPES.find(t => (e.types ?? []).includes(`urn:entity:${t}`));
      if (!type) return [];
      const p = (e.properties ?? {}) as { short_description?: string; description?: string; release_year?: number };
      const full = (p.short_description ?? p.description ?? "").replace(/\s+/g, " ").trim();
      const about = full.length > 110 ? `${full.slice(0, 110).replace(/\s+\S*$/, "")}…` : full || null;
      return [{ id: e.entity_id, name: e.name, type, about }];
    }).slice(0, 8);
  });
}

/** The desk for one of those records: the existing one if someone set it up already, else a new one. */
export async function setUp(q: string, entityId: string): Promise<{ ok: true; id: string } | { ok: false; why: string }> {
  const e = (await find(q))?.find(x => x.id === entityId);
  if (!e) return { ok: false, why: "That record didn't come back from Qloo for this search. Search again." };
  const [have] = (await sql()`select id from custom_desks where entity_id = ${e.id}`) as { id: string }[];
  if (have) return { ok: true, id: have.id };
  const [{ n }] = (await sql()`select count(*)::int n from custom_desks where created_at > now() - interval '1 day'`) as { n: number }[];
  if (n >= DESKS_PER_DAY) return { ok: false, why: "Today's new desks are all set up. Try again tomorrow, or open one of the judges' desks." };
  const id = `my-${slugify(e.name, 40) || "desk"}-${token(3).toLowerCase()}`;
  await sql()`insert into custom_desks (id, entity_id, name, type) values (${id}, ${e.id}, ${e.name}, ${e.type}) on conflict (entity_id) do nothing`;
  const [row] = (await sql()`select id from custom_desks where entity_id = ${e.id}`) as { id: string }[];
  return { ok: true, id: row.id };
}
