// Scout: picks a seed, finds non-obvious partners for it in Qloo, scores each pair on the
// rubric, and publishes a thesis for anything that clears WATCH. Every step is an action.

import { sql } from "./db";
import { logAction } from "./actions";
import { ask } from "./llm";
import { resolveHandle } from "./handles";
import { RUBRIC_VERSION, score, sharedTags, type Raw } from "./rubric";
import {
  audienceTags, demographics, entities, heatmap, pull, search, topFor, trending,
  type EntityType, type QlooEntity,
} from "./qloo";

// Starting pool. Scout adds every partner it scores, so the pool grows on its own.
export const SEEDS: { name: string; type: EntityType }[] = [
  { name: "A24", type: "brand" },
  { name: "Blumhouse Productions", type: "brand" },
  { name: "Liquid Death", type: "brand" },
  { name: "Patagonia", type: "brand" },
  { name: "Crocs", type: "brand" },
  { name: "Duolingo", type: "brand" },
  { name: "Glossier", type: "brand" },
  { name: "Red Bull", type: "brand" },
  { name: "Phoebe Bridgers", type: "artist" },
  { name: "Bad Bunny", type: "artist" },
  { name: "Charli XCX", type: "artist" },
  { name: "Tyler, the Creator", type: "artist" },
  { name: "Severance", type: "tv_show" },
  { name: "The Bear", type: "tv_show" },
  { name: "Hacks", type: "tv_show" },
];

// Pair a seed with these types. Brands are the buyers, so every pair keeps a brand on one side.
const PARTNER_TYPES: Record<string, EntityType[]> = {
  brand: ["artist", "tv_show", "brand"],
  artist: ["brand"],
  tv_show: ["brand"],
};

const LIST = 50;              // how deep "top list" goes for the surprise dimension
const SKIP_TOP = 10;          // candidates in the seed's own top 10 are too obvious
const HEAT_LOCATION = "United States";

const typeOf = (e: QlooEntity): EntityType =>
  ((e.types?.[0] ?? e.subtype ?? "urn:entity:brand").split(":").pop() as EntityType);

// ---- shape helpers (Qloo's insight payloads differ per filter.type) ----

function findArrays(o: unknown, pred: (x: Record<string, unknown>) => boolean, out: Record<string, unknown>[] = []) {
  if (Array.isArray(o)) {
    if (o.length && o.every(x => x && typeof x === "object") && pred(o[0] as Record<string, unknown>)) out.push(...(o as Record<string, unknown>[]));
    else o.forEach(x => findArrays(x, pred, out));
  } else if (o && typeof o === "object") Object.values(o).forEach(v => findArrays(v, pred, out));
  return out;
}

function findKey(o: unknown, key: string): unknown {
  if (!o || typeof o !== "object") return undefined;
  if (key in (o as object)) return (o as Record<string, unknown>)[key];
  for (const v of Object.values(o)) { const r = findKey(v, key); if (r !== undefined) return r; }
  return undefined;
}

export function ageVector(resp: unknown): Record<string, number> | null {
  const age = findKey(resp, "age");
  if (!age || typeof age !== "object") return null;
  const v = Object.fromEntries(Object.entries(age).filter(([, x]) => typeof x === "number")) as Record<string, number>;
  return Object.keys(v).length ? v : null;
}

export function topCells(resp: unknown, n = 25): string[] {
  const cells = findArrays(resp, x => "location" in x || "geohash" in x);
  return cells
    .map(c => {
      const loc = (c.location ?? c) as Record<string, unknown>;
      const q = (c.query ?? c) as Record<string, unknown>;
      return { g: String(loc.geohash ?? ""), a: Number(q.affinity ?? q.affinity_rank ?? 0) };
    })
    .filter(c => c.g)
    .sort((x, y) => y.a - x.a)
    .slice(0, n)
    .map(c => c.g.slice(0, 4)); // ~20-40km cells, so two cities can actually line up
}

/** -1..1: change in the last week's mean vs the week before, from whatever daily series comes back. */
export function momentum(resp: unknown): number | null {
  const pts = findArrays(resp, x => "date" in x || "day" in x)
    .sort((x, y) => String(x.date ?? x.day).localeCompare(String(y.date ?? y.day))); // arrives newest-first
  const vals = pts
    .map(p => Number(p.population_percentile ?? p.percentile ?? p.value ?? p.population_rank ?? NaN))
    .filter(Number.isFinite);
  if (vals.length < 8) return null;
  const recent = vals.slice(-7), before = vals.slice(-14, -7);
  const m = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const base = m(before) || 1;
  return Math.max(-1, Math.min(1, (m(recent) - m(before)) / Math.abs(base)));
}

function industryOf(e: QlooEntity): string | null {
  const i = e.properties?.industry;
  if (typeof i === "string") return i.toLowerCase();
  if (Array.isArray(i) && i.length) return String((i[0] as { name?: string })?.name ?? i[0]).toLowerCase();
  return null;
}

// ---- persistence ----

async function saveEntity(e: QlooEntity) {
  const h = await resolveHandle(e);
  await sql()`
    insert into entities (qloo_id, name, type, popularity, official_site, wikidata, x_handle, x_handle_status, x_handle_sources, raw, updated_at)
    values (${e.entity_id}, ${e.name}, ${typeOf(e)}, ${e.popularity ?? null}, ${h.officialSite}, ${h.wikidata},
            ${h.handle}, ${h.status}, ${JSON.stringify(h.sources)}, ${JSON.stringify(e)}, now())
    on conflict (qloo_id) do update set
      name = excluded.name, popularity = coalesce(excluded.popularity, entities.popularity),
      official_site = excluded.official_site, wikidata = excluded.wikidata, x_handle = excluded.x_handle,
      x_handle_status = excluded.x_handle_status, x_handle_sources = excluded.x_handle_sources,
      raw = excluded.raw, updated_at = now()`;
  return h;
}

// ---- the pair ----

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function trendFor(e: QlooEntity) {
  const t = typeOf(e);
  if (t === "brand") return null; // Qloo has no trending data for brands
  const end = new Date(), start = new Date(Date.now() - 120 * 864e5); // data lags by weeks;
  try { return momentum(await trending([e.entity_id], t, isoDay(start), isoDay(end))); } catch { return null; }
}

const rankIn = (list: QlooEntity[], id: string) => {
  const i = list.findIndex(x => x.entity_id === id);
  return i < 0 ? null : i + 1;
};

const safe = <T,>(p: Promise<T>) => p.catch(() => null);

export async function measure(a: QlooEntity, b: QlooEntity): Promise<Raw> {
  const ta = typeOf(a), tb = typeOf(b);
  const [pAB, pBA, listA, listB, demA, demB, heatA, heatB, momA, momB, tagsA, tagsB] = await Promise.all([
    pull([a.entity_id], b.entity_id, tb),
    pull([b.entity_id], a.entity_id, ta),
    topFor([a.entity_id], tb, LIST),
    topFor([b.entity_id], ta, LIST),
    safe(demographics([a.entity_id])),
    safe(demographics([b.entity_id])),
    safe(heatmap([a.entity_id], HEAT_LOCATION)),
    safe(heatmap([b.entity_id], HEAT_LOCATION)),
    trendFor(a),
    trendFor(b),
    audienceTags([a.entity_id]).catch(() => [] as string[]),
    audienceTags([b.entity_id]).catch(() => [] as string[]),
  ]);
  const ia = industryOf(a), ib = industryOf(b);
  return {
    pullAB: pAB?.affinity ?? null,
    pullBA: pBA?.affinity ?? null,
    sameType: ta === tb,
    sameIndustry: ia && ib ? ia === ib : null,
    popA: a.popularity ?? null,
    popB: b.popularity ?? null,
    rankBinA: rankIn(listA, b.entity_id),
    rankAinB: rankIn(listB, a.entity_id),
    listSize: LIST,
    tagsA,
    tagsB,
    ageA: ageVector(demA),
    ageB: ageVector(demB),
    cellsA: topCells(heatA),
    cellsB: topCells(heatB),
    momentumA: momA,
    momentumB: momB,
  };
}

const THESIS_SYSTEM = `You write one-paragraph partnership theses from Qloo audience data.
Rules: describe aggregate audience affinity only, never individuals. Never claim a partnership
will cause sales or growth. Name the source as "Qloo taste data". Two to three sentences, plain
English, no hype words, no em dashes. Lead with the non-obvious overlap.
Affinity values are scores from 0 to 1, never percentages or shares of an audience.`;

export async function writeThesis(a: QlooEntity, b: QlooEntity, raw: Raw, scored: ReturnType<typeof score>) {
  const shared = sharedTags(raw.tagsA, raw.tagsB).slice(0, 8);
  const facts = {
    a: a.name, b: b.name, pull_a_to_b: raw.pullAB, pull_b_to_a: raw.pullBA,
    shared_taste_tags: shared,
    score: Number(scored.score.toFixed(3)), band: scored.band,
  };
  try {
    return await ask("write", THESIS_SYSTEM, JSON.stringify(facts), 250);
  } catch (e) {
    // Gateway unavailable: publish the plain-numbers version rather than nothing.
    const text = `On Qloo taste data, ${a.name}'s audience scores ${b.name} at ${raw.pullAB?.toFixed(2) ?? "n/a"} affinity, and ${b.name}'s audience scores ${a.name} at ${raw.pullBA?.toFixed(2) ?? "n/a"}.` +
      (shared.length ? ` They share taste in ${shared.slice(0, 3).join(", ")}.` : "");
    return { text, model: `fallback (${(e as Error).message.slice(0, 60)})`, costUsd: null };
  }
}

export async function scorePair(a0: QlooEntity, b0: QlooEntity) {
  const full = await entities([a0.entity_id, b0.entity_id]).catch(() => [] as QlooEntity[]);
  const pick = (e: QlooEntity) => {
    const f = full.find(x => x.entity_id === e.entity_id);
    return f ? { ...e, ...f, properties: { ...e.properties, ...f.properties } } : e;
  };
  const a = pick(a0), b = pick(b0);
  await Promise.all([saveEntity(a), saveEntity(b)]);
  const raw = await measure(a, b);
  const scored = score(raw);

  let thesis: Awaited<ReturnType<typeof writeThesis>> | null = null;
  if (scored.band !== "PASS") thesis = await writeThesis(a, b, raw, scored);

  const rows = (await sql()`
    insert into pairs (a_id, b_id, dims, score, band, thesis, rubric_version)
    values (${a.entity_id}, ${b.entity_id}, ${JSON.stringify({ raw, dims: scored.dims, gate: scored.gate })},
            ${scored.score}, ${scored.band}, ${thesis?.text ?? null}, ${RUBRIC_VERSION})
    on conflict (a_id, b_id, rubric_version) do update set
      dims = excluded.dims, score = excluded.score, band = excluded.band, called_at = now(),
      -- A pair rescored to PASS loses its thesis: the old text would argue for numbers that no longer hold.
      thesis = case when excluded.band = 'PASS' then null else coalesce(excluded.thesis, pairs.thesis) end
    returning id`) as { id: string }[];
  const pairId = rows[0].id;

  await logAction({
    agent: "scout",
    kind: thesis ? "thesis.published" : "pair.passed",
    summary: thesis
      ? `${scored.band} ${a.name} × ${b.name} (${scored.score.toFixed(2)}). Thesis published.`
      : `PASS ${a.name} × ${b.name} (${scored.score.toFixed(2)})${scored.gate ? `: ${scored.gate}` : ""}.`,
    refTable: "pairs",
    refId: pairId,
    detail: { model: thesis?.model ?? null },
    llmCostUsd: thesis?.costUsd ?? null,
  });
  return { pairId, ...scored };
}

/** Candidates from the seed's own Qloo list, skipping the obvious top picks and partners already scored. */
export async function candidates(seed: QlooEntity, type: EntityType, n: number, seen = new Set<string>()) {
  const list = await topFor([seed.entity_id], type, LIST);
  const pool = list.filter(e => e.entity_id !== seed.entity_id).slice(SKIP_TOP).filter(e => !seen.has(e.entity_id));
  // Spread picks across the rest of the list rather than taking ranks 11, 12, 13.
  const step = Math.max(1, Math.floor(pool.length / n));
  return pool.filter((_, i) => i % step === 0).slice(0, n);
}

async function pickSeed(): Promise<{ name: string; type: EntityType }> {
  // Least-recently scouted seed first, so the floor keeps moving across the pool.
  const rows = (await sql()`
    select e.name, e.type, max(p.called_at) as last
    from entities e left join pairs p on p.a_id = e.qloo_id
    group by e.qloo_id, e.name, e.type`) as { name: string; type: string; last: string | null }[];
  const last = new Map(rows.map(r => [r.name.toLowerCase(), r.last ? Date.parse(r.last) : 0]));
  return [...SEEDS].sort((x, y) => (last.get(x.name.toLowerCase()) ?? 0) - (last.get(y.name.toLowerCase()) ?? 0))[0];
}

/** One Scout run: one seed, a few partners per partner type. */
export async function runScout(opts: { seed?: { name: string; type: EntityType }; perType?: number } = {}) {
  const seedDef = opts.seed ?? (await pickSeed());
  const [seed] = await search(seedDef.name, seedDef.type, 1);
  if (!seed) {
    await logAction({ agent: "scout", kind: "seed.missing", summary: `No Qloo entity found for "${seedDef.name}".` });
    return [];
  }
  await logAction({ agent: "scout", kind: "seed.picked", summary: `Scouting partners for ${seed.name}.`, detail: { entity_id: seed.entity_id } });

  // Partners this seed was already paired with, either way round, so each pass brings new pairs.
  const seen = new Set(((await sql()`
    select case when a_id = ${seed.entity_id} then b_id else a_id end as id from pairs
    where a_id = ${seed.entity_id} or b_id = ${seed.entity_id}`) as { id: string }[]).map(r => r.id));
  const out = [];
  for (const t of PARTNER_TYPES[typeOf(seed)] ?? ["brand"]) {
    for (const c of await candidates(seed, t, opts.perType ?? 2, seen)) {
      try { out.push({ a: seed.name, b: c.name, ...(await scorePair(seed, c)) }); }
      catch (e) {
        await logAction({ agent: "scout", kind: "pair.error", summary: `Could not score ${seed.name} × ${c.name}.`, detail: { error: (e as Error).message.slice(0, 300) } });
      }
    }
  }
  return out;
}
