// The Qloo corpus: every pair Qloo measured for us (the pre-scored queue plus the pairs Scout measured live),
// folded into one profile per entity and one edge per measured pair. Read-only; costs no Qloo calls.
import { sql } from "./db";
import { metroOf } from "./geo";
import type { Raw } from "./rubric";
import type { QlooEntity } from "./qloo";

export type Profile = {
  id: string; name: string; type: string; popularity: number | null;
  tags: Set<string>; age: Record<string, number> | null;
  metros: Map<string, number>; // metro -> weight from the heatmap rank (1 = top cell)
};
export type Edge = { partnerId: string; toward: number; back: number; band: string };

const typeOf = (e: QlooEntity) => (e.types?.[0] ?? "").split(":").pop() || "brand";

function metroWeights(cells: string[] | undefined) {
  const m = new Map<string, number>();
  (cells ?? []).forEach((c, i, all) => { const k = metroOf(c); if (k) m.set(k, Math.max(m.get(k) ?? 0, 1 - i / all.length)); });
  return m;
}

let cached: { profiles: Map<string, Profile>; edges: Map<string, Edge[]> } | null = null;

export async function loadCorpus() {
  if (cached) return cached;
  // Only the fields the profiles need: full Qloo records and raw payloads run to megabytes.
  const rows = (await sql()`
    with src as (
      select a_id, b_id, a->>'name' an, a->'types' atypes, b->>'name' bn, b->'types' btypes, band, dims->'raw' raw from pair_queue where dims ? 'raw'
      union all
      select p.a_id, p.b_id, ea.name, jsonb_build_array('urn:entity:' || ea.type), eb.name, jsonb_build_array('urn:entity:' || eb.type), p.band, p.dims->'raw'
      from pairs p join entities ea on ea.qloo_id = p.a_id join entities eb on eb.qloo_id = p.b_id where p.dims ? 'raw')
    select a_id, b_id, jsonb_build_object('name', an, 'types', atypes) a, jsonb_build_object('name', bn, 'types', btypes) b, band,
      jsonb_build_object('tagsA', raw->'tagsA', 'tagsB', raw->'tagsB', 'ageA', raw->'ageA', 'ageB', raw->'ageB', 'cellsA', raw->'cellsA',
        'cellsB', raw->'cellsB', 'popA', raw->'popA', 'popB', raw->'popB', 'pullAB', raw->'pullAB', 'pullBA', raw->'pullBA') raw
    from src`) as {
      a_id: string; b_id: string; a: QlooEntity; b: QlooEntity; band: string; raw: Raw;
    }[];
  const profiles = new Map<string, Profile>(), edges = new Map<string, Edge[]>();
  const fold = (id: string, e: QlooEntity, tags: string[] | undefined, age: Record<string, number> | null, cells: string[] | undefined, pop: number | null) => {
    const p = profiles.get(id) ?? { id, name: e.name, type: typeOf(e), popularity: pop, tags: new Set<string>(), age: null, metros: new Map() };
    (tags ?? []).forEach(t => p.tags.add(t));
    p.age ??= age; p.popularity ??= pop;
    if (!p.metros.size) p.metros = metroWeights(cells);
    profiles.set(id, p);
  };
  for (const r of rows) {
    const w = r.raw;
    fold(r.a_id, r.a, w.tagsA, w.ageA, w.cellsA, w.popA);
    fold(r.b_id, r.b, w.tagsB, w.ageB, w.cellsB, w.popB);
    if (w.pullAB == null || w.pullBA == null) continue;
    (edges.get(r.a_id) ?? edges.set(r.a_id, []).get(r.a_id)!).push({ partnerId: r.b_id, toward: w.pullAB, back: w.pullBA, band: r.band });
    (edges.get(r.b_id) ?? edges.set(r.b_id, []).get(r.b_id)!).push({ partnerId: r.a_id, toward: w.pullBA, back: w.pullAB, band: r.band });
  }
  cached = { profiles, edges };
  return cached;
}

/** IDF-weighted cosine over tag sets: rare shared tags count for more than "friendship" or "love". */
export function tagSimilarity(a: Set<string>, b: Set<string>, df: Map<string, number>, n: number) {
  const idf = (t: string) => Math.log(n / (1 + (df.get(t) ?? 0))) + 1;
  let dot = 0, na = 0, nb = 0;
  for (const t of a) { const w = idf(t) ** 2; na += w; if (b.has(t)) dot += w; }
  for (const t of b) nb += idf(t) ** 2;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function tagFrequencies(profiles: Map<string, Profile>) {
  const df = new Map<string, number>();
  for (const p of profiles.values()) for (const t of p.tags) df.set(t, (df.get(t) ?? 0) + 1);
  return df;
}
