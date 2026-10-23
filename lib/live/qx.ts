// Live Qloo reads for desk runs, built on what the first month taught us: every answer is cached by its exact question
// (a run never pays twice), affinity is measured for up to 20 targets in one call (filter.entities takes a list), and an
// entity's audience profile (tags, age, cities) is fetched once and kept for 30 days.
import { sql } from "../db";
import { audienceTags, demographics, heatmap, qloo, search, topFor, type EntityType, type QlooEntity } from "../qloo";
import { ageVector, topCells } from "../scout";
import { loadCorpus, type Profile } from "../corpus";
import { metroOf } from "../geo";
import { SENSITIVE, type Side } from "../match";

type Envelope = { results?: QlooEntity[] | { entities?: QlooEntity[] } };
const list = (r: Envelope) => (Array.isArray(r.results) ? r.results : r.results?.entities ?? []);
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function cached<T>(key: string, days: number, f: () => Promise<T>): Promise<T> {
  const [hit] = (await sql()`select value from qloo_cache where key = ${key} and fetched_at > now() - make_interval(days => ${days})`) as { value: T }[];
  if (hit) return hit.value;
  const v = await f();
  await sql()`insert into qloo_cache (key, value) values (${key}, ${JSON.stringify(v)})
    on conflict (key) do update set value = excluded.value, fetched_at = now()`;
  return v;
}

export type Ent = { id: string; name: string; type: EntityType; popularity: number | null; site: string | null };
const ent = (e: QlooEntity, type: EntityType): Ent => ({
  id: e.entity_id, name: e.name, type, popularity: e.popularity ?? null,
  site: (e.properties?.official_site as string | undefined) ?? null,
});

/** The Qloo entity for a name and type (Cedric is both a person and an artist in Qloo; the type picks which). */
export const resolve = (name: string, type: EntityType) =>
  cached(`resolve:${type}:${name.toLowerCase()}`, 30, async () => {
    const hits = await search(name, type, 5);
    const exact = hits.find(e => e.name.toLowerCase() === name.toLowerCase()) ?? null;
    return exact ? ent(exact, type) : null;
  });

/** What the signal's audience over-indexes on, with Qloo's affinity for each (the affinity comes free with the list). */
// `tags` narrows the list to a category: brand genre tags like urn:tag:genre:brand:wine_and_spirits (filter.tags).
// `location` leans the list toward one city's taste (signal.location.query), e.g. a venue's crowd in its own metro.
// `within` keeps only candidates in that city (filter.location.query): rooms to hold in San Juan are in San Juan.
export const top = (signal: string[], type: EntityType, take = 40, tags: string[] = [], location?: string, within?: string) =>
  cached(`top:${type}:${signal.join("+")}:${take}${tags.length ? `:${tags.join("|")}` : ""}${location ? `@${location.toLowerCase()}` : ""}${within ? `in:${within.toLowerCase()}` : ""}`, 7, async () => {
    const r = tags.length || location || within
      ? list(await qloo<Envelope>("/v2/insights", { "filter.type": `urn:entity:${type}`, "signal.interests.entities": signal,
          ...(tags.length ? { "filter.tags": tags } : {}), ...(location ? { "signal.location.query": location } : {}),
          ...(within ? { "filter.location.query": within } : {}), take }))
      : await topFor(signal, type, take);
    return r.map(e => ({ ...ent(e, type), affinity: e.query?.affinity ?? null }));
  });

/** How much the signal's audience likes each target, 0 to 1. Up to 20 targets per call; cached per target. */
export async function affinities(signal: string[], targets: string[], type: EntityType) {
  const key = (t: string) => `aff:${signal.join("+")}:${type}:${t}`;
  const out = new Map<string, number | null>();
  const have = (await sql()`select key, value from qloo_cache where key = any(${targets.map(key)}) and fetched_at > now() - interval '7 days'`) as { key: string; value: number | null }[];
  for (const h of have) out.set(h.key.split(":").pop()!, h.value);
  for (const ids of chunk(targets.filter(t => !out.has(t)), 20)) {
    const r = await qloo<Envelope>("/v2/insights", { "filter.type": `urn:entity:${type}`, "signal.interests.entities": signal, "filter.entities": ids, take: ids.length });
    const got = new Map(list(r).map(e => [e.entity_id, e.query?.affinity ?? null]));
    for (const id of ids) {
      const v = got.get(id) ?? null;
      out.set(id, v);
      await sql()`insert into qloo_cache (key, value) values (${key(id)}, ${JSON.stringify(v)}) on conflict (key) do update set value = excluded.value, fetched_at = now()`;
    }
  }
  return out;
}

export type LiveProfile = { tags: string[]; age: Record<string, number> | null; cells: string[] };

/** An entity's audience profile: the corpus copy when we have one (free), else three Qloo calls, kept 30 days. */
export async function profile(id: string): Promise<LiveProfile> {
  const { profiles } = await loadCorpus();
  const c = profiles.get(id);
  if (c?.tags.size) return { tags: [...c.tags], age: c.age, cells: [...c.metros.keys()] };
  return cached(`profile:${id}`, 30, async () => {
    const [tags, dem, heat] = await Promise.all([
      audienceTags([id]).catch(() => [] as string[]),
      demographics([id]).catch(() => null),
      heatmap([id], "United States").catch(() => null),
    ]);
    return { tags, age: dem ? ageVector(dem) : null, cells: heat ? topCells(heat) : [] };
  });
}

/** A profile as one side of our match score. Corpus profiles keep their own metro weights. */
export async function sideOf(e: { id: string; name: string }): Promise<Side> {
  const { profiles } = await loadCorpus();
  const c: Profile | undefined = profiles.get(e.id);
  if (c?.tags.size) return { id: c.id, name: c.name, tags: c.tags, age: c.age, metros: c.metros };
  const p = await profile(e.id);
  const metros = new Map<string, number>();
  p.cells.forEach((cell, i) => { const k = metroOf(cell) ?? cell; if (!metros.has(k)) metros.set(k, 1 - i / Math.max(1, p.cells.length)); });
  return { id: e.id, name: e.name, tags: new Set(p.tags), age: p.age, metros };
}

/** Several audiences read as one (a lineup, a room's acts): tastes at least two of them share, ages averaged, cities summed. */
export function mergeSides(name: string, sides: Side[]): Side {
  if (sides.length === 1) return sides[0];
  const count = new Map<string, number>();
  for (const s of sides) for (const t of s.tags) count.set(t, (count.get(t) ?? 0) + 1);
  const ages = sides.map(s => s.age).filter((a): a is Record<string, number> => !!a);
  const age = ages.length ? Object.fromEntries(Object.keys(ages[0]).map(k => [k, ages.reduce((x, a) => x + (a[k] ?? 0), 0) / ages.length])) : null;
  const metros = new Map<string, number>();
  for (const s of sides) for (const [m, w] of s.metros) metros.set(m, (metros.get(m) ?? 0) + w / sides.length);
  return { name, tags: new Set([...count].filter(([, n]) => n >= 2).map(([t]) => t)), age, metros };
}

// Audience families safe to name in a pitch. Communities, beliefs, politics and the like describe who people are, which
// SYZYGY never puts in a message.
const SAFE_AUDIENCE = /\((hobbies and interests|leisure|professional area)\)$/i;

/** Interest groups the signal's audience over-indexes on (Qloo audiences), safe ones only. */
export const audiences = (signal: string[], take = 6) =>
  cached(`aud:${signal.join("+")}`, 7, async () => {
    const r = await qloo<{ results?: { entities?: { name: string; entity_id: string; disambiguation?: string; query?: { affinity?: number } }[] } }>(
      "/v2/insights", { "filter.type": "urn:audience", "signal.interests.entities": signal, take: 40 });
    return (r.results?.entities ?? []).filter(a => SAFE_AUDIENCE.test(a.disambiguation ?? "") && !SENSITIVE.test(a.name))
      .slice(0, take).map(a => ({ name: a.name, family: (a.disambiguation ?? "").replace(/^.*\(|\)$/g, ""), affinity: a.query?.affinity ?? null }));
  });

/** Brands the signal's audience leans toward in one city (their local taste). */
export const localBrands = (signal: string[], city: string, take = 5) =>
  cached(`local:${signal.join("+")}:${city.toLowerCase()}`, 7, async () => {
    const r = await qloo<Envelope>("/v2/insights", { "filter.type": "urn:entity:brand", "signal.interests.entities": signal, "signal.location.query": city, take });
    return list(r).map(e => ({ name: e.name, affinity: e.query?.affinity ?? null }));
  });

/** Everything Qloo says about one audience that a desk can use: its network of people, shows, podcasts and interests. */
export async function audienceInsights(signal: string[], city: string | null) {
  const [people, podcasts, shows, groups, local] = await Promise.all([
    top(signal, "person", 8).catch(() => []),
    top(signal, "podcast", 6).catch(() => []),
    top(signal, "tv_show", 6).catch(() => []),
    audiences(signal).catch(() => []),
    city ? localBrands(signal, city).catch(() => []) : Promise.resolve([]),
  ]);
  // Qloo can hold two entries under one name (two "Adam Young"s), so names are listed once.
  const names = (xs: { name: string }[]) => [...new Set(xs.map(x => x.name))];
  return {
    people: names(people), podcasts: names(podcasts), shows: names(shows),
    audiences: groups, city, local,
  };
}
export type Insights = Awaited<ReturnType<typeof audienceInsights>>;
