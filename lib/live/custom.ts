// "Find yours" on /desk: a visitor types a brand, artist, person, show or podcast, picks Qloo's record of it, and gets a desk
// whose live run reads that audience. Searches are cached a week and capped per day, so the page can't drain the quota.
import { sql } from "../db";
import { qloo, type QlooEntity } from "../qloo";
import { slugify, token } from "../slug";
import type { CustomEntity } from "../personas";
import { cached } from "./qx";
import { imageFor, qlooImage } from "./image";

const TYPES: CustomEntity["type"][] = ["brand", "artist", "person", "tv_show", "movie", "podcast"];
const SEARCHES_PER_DAY = 300, DESKS_PER_DAY = 60;

export type Found = CustomEntity & { about: string | null; image: string | null; pop: number; top: number };

const clean = (q: string) => q.trim().replace(/\s+/g, " ").slice(0, 60);
const norm = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

/** Qloo's records matching a name, the kinds a desk can work for. Null when today's searches are used up. */
export async function find(q: string): Promise<Found[] | null> {
  const query = clean(q);
  if (query.length < 2) return [];
  // v4 keys carry the image and popularity; still under "find:" so the daily cap counts them.
  const key = `find:v4:${query.toLowerCase()}`;
  const [hit] = (await sql()`select 1 from qloo_cache where key = ${key} and fetched_at > now() - interval '7 days'`) as unknown[];
  if (!hit) {
    const [{ n }] = (await sql()`select count(*)::int n from qloo_cache where key like 'find:%' and fetched_at > now() - interval '1 day'`) as { n: number }[];
    if (n >= SEARCHES_PER_DAY) return null;
  }
  return cached(key, 7, async () => {
    const r = await qloo<{ results?: QlooEntity[] }>("/search", { query, take: 12 });
    const all = r.results ?? [];
    // The best-known record whose name holds what was typed (Becky G for "becky"), of any kind, so best() can tell whether
    // the exact name is what people mean by it. Fuzzy hits (Death Cab for Cutie for "Liquid Death") don't count.
    const top = Math.max(0, ...all.filter(e => norm(e.name).includes(norm(query))).map(e => e.popularity ?? 0));
    return all.flatMap(e => {
      const type = TYPES.find(t => (e.types ?? []).includes(`urn:entity:${t}`));
      if (!type) return [];
      const p = (e.properties ?? {}) as { short_description?: string; description?: string; release_year?: number };
      const full = (p.short_description ?? p.description ?? "").replace(/\s+/g, " ").trim();
      const about = full.length > 110 ? `${full.slice(0, 110).replace(/\s+\S*$/, "")}…` : full || null;
      return [{ id: e.entity_id, name: e.name, type, about, image: qlooImage(e), pop: e.popularity ?? 0, top }];
    }).slice(0, 8);
  });
}

// When one name is several records (Becky G is an artist and a person), the one with the most lanes wins: an artist desk
// works sponsors, rooms and a feature; a person desk only brand deals and a collab.
const FIRST: CustomEntity["type"][] = ["artist", "brand", "podcast", "tv_show", "person", "movie"];
const same = (a: string, b: string) => norm(a) === norm(b);

/**
 * The record a search means without asking: named exactly what was typed, and that name is the most popular thing Qloo
 * found ("becky" finds a Becky, but Becky G is far better known, so the list shows). Null when it isn't clear.
 */
export function best(q: string, found: Found[]): Found | null {
  const exact = found.filter(e => same(e.name, clean(q)));
  const lead = Math.max(0, ...exact.map(e => e.pop));
  if (!exact.length || lead < (found[0]?.top ?? 0) - 0.005) return null;
  // Among the records with that name, the well-known ones; then the kind with the most lanes; then the better known.
  return exact.filter(e => e.pop >= lead - 0.05)
    .sort((a, b) => FIRST.indexOf(a.type) - FIRST.indexOf(b.type) || b.pop - a.pop)[0];
}

export type SetUpDesk = { id: string; name: string; type: CustomEntity["type"]; image: string | null };

/** The desks visitors set up, newest first, for /desk. */
export async function recentDesks(n = 14): Promise<SetUpDesk[]> {
  return (await sql()`select id, name, type, image from custom_desks order by created_at desc limit ${n}`) as SetUpDesk[];
}

// Why a setup didn't happen, by code: the page shows only these, never text taken from its own address.
export const SETUP_WHY = {
  gone: "That record didn't come back from Qloo for this search. Search again.",
  full: "Today's new desks are all set up. Try again tomorrow, or open one of the brand desks.",
} as const;

/** The desk for one of those records: the existing one if someone set it up already, else a new one. */
export async function setUp(q: string, entityId: string): Promise<{ ok: true; id: string } | { ok: false; why: keyof typeof SETUP_WHY }> {
  const e = (await find(q))?.find(x => x.id === entityId);
  if (!e) return { ok: false, why: "gone" };
  const [have] = (await sql()`select id from custom_desks where entity_id = ${e.id}`) as { id: string }[];
  if (have) return { ok: true, id: have.id };
  const [{ n }] = (await sql()`select count(*)::int n from custom_desks where created_at > now() - interval '1 day'`) as { n: number }[];
  if (n >= DESKS_PER_DAY) return { ok: false, why: "full" };
  const id = `my-${slugify(e.name, 40) || "desk"}-${token(3).toLowerCase()}`;
  const image = await imageFor(e.name, e.image ?? null);
  await sql()`insert into custom_desks (id, entity_id, name, type, image) values (${id}, ${e.id}, ${e.name}, ${e.type}, ${image}) on conflict (entity_id) do nothing`;
  const [row] = (await sql()`select id from custom_desks where entity_id = ${e.id}`) as { id: string }[];
  return { ok: true, id: row.id };
}
