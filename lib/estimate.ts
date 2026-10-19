// Estimated pairs: brand × artist/show combinations Qloo never measured, found with OUR match score on the stored corpus.
// No Qloo calls. They enter the queue labelled as SYZYGY estimates and run down the same chain as measured pairs, with
// the brand's own Qloo-measured partners as supporting evidence. Never presented as Qloo numbers.
// Calibration (19 Oct, measured queue at rubric v1.2): pairs we score 90+ were Qloo WATCH-or-better 97% of the time and
// PITCH 53% (base rates 49% and 10%); 85+ were 93% and 47%. Caveat: those pairs came from Qloo's own top-50 lists.
import { sql } from "./db";
import { loadCorpus } from "./corpus";
import { sideOf, syzygyMatch } from "./match";
import { excludedIds } from "./prescore";
import type { QlooEntity } from "./qloo";
import type { Raw } from "./rubric";

export const EST_VERSION = "syzygy-est-1";
export const EST_CUTOFFS = { pitch: 90, watch: 85 } as const;
const PER_TALENT = 25;

export type Estimate = { score: number; strength: string; parts: { taste: number; age: number | null; cities: number }; sharedTags: string[]; sharedCities: string[] };

export async function estimatePairs(opts: { dryRun?: boolean } = {}) {
  const { profiles, edges } = await loadCorpus();
  // Full Qloo records, so saving an entity later never wipes its stored website or handle.
  const recs = new Map<string, QlooEntity>();
  for (const r of (await sql()`select a_id, b_id, a, b from pair_queue`) as { a_id: string; b_id: string; a: QlooEntity; b: QlooEntity }[]) {
    recs.set(r.a_id, r.a); recs.set(r.b_id, r.b);
  }
  const measured = new Set(((await sql()`select a_id, b_id from pair_queue union all select a_id, b_id from pairs`) as { a_id: string; b_id: string }[]).map(r => [r.a_id, r.b_id].sort().join("|")));
  for (const [id, es] of edges) for (const e of es) measured.add([id, e.partnerId].sort().join("|"));
  const excluded = await excludedIds();
  const brands = [...profiles.values()].filter(p => p.type === "brand" && p.tags.size && recs.has(p.id) && !excluded.has(p.id));
  const talent = [...profiles.values()].filter(p => (p.type === "artist" || p.type === "tv_show") && p.tags.size && recs.has(p.id));
  const found: { t: string; b: string; m: Estimate }[] = [];
  for (const t of talent) for (const b of brands) {
    if (measured.has([t.id, b.id].sort().join("|"))) continue;
    const m = await syzygyMatch(sideOf(t), sideOf(b));
    if (m.score >= EST_CUTOFFS.watch) found.push({ t: t.id, b: b.id, m: { score: m.score, strength: m.strength, parts: m.parts, sharedTags: m.sharedTags, sharedCities: m.sharedCities } });
  }
  // Spread: each brand once (a brand is only ever pitched once), each artist or show at most PER_TALENT times.
  const perTalent = new Map<string, number>(), usedBrand = new Set<string>(), keep: typeof found = [];
  for (const f of found.sort((x, y) => y.m.score - x.m.score)) {
    if (usedBrand.has(f.b) || (perTalent.get(f.t) ?? 0) >= PER_TALENT) continue;
    usedBrand.add(f.b); perTalent.set(f.t, (perTalent.get(f.t) ?? 0) + 1); keep.push(f);
  }
  if (opts.dryRun) return { candidates: found.length, kept: keep.length, pitch: keep.filter(k => k.m.score >= EST_CUTOFFS.pitch).length };
  let inserted = 0;
  for (const k of keep) {
    const t = profiles.get(k.t)!, b = profiles.get(k.b)!;
    // The same shape Scout reads from a measured row, with no Qloo pulls: the rubric never scores an estimate.
    const raw: Raw = {
      pullAB: null, pullBA: null, sameType: false, sameIndustry: null, popA: t.popularity, popB: b.popularity, rankBinA: null, rankAinB: null,
      listSize: 0, tagsA: [...t.tags], tagsB: [...b.tags], ageA: t.age, ageB: b.age, cellsA: [], cellsB: [], momentumA: null, momentumB: null,
    };
    const band = k.m.score >= EST_CUTOFFS.pitch ? "PITCH" : "WATCH";
    const r = (await sql()`insert into pair_queue (a_id, b_id, a, b, score, band, dims, rubric_version, status, note)
      values (${k.t}, ${k.b}, ${JSON.stringify(recs.get(k.t))}, ${JSON.stringify(recs.get(k.b))}, ${k.m.score / 100}, ${band},
              ${JSON.stringify({ estimate: k.m, raw })}, ${EST_VERSION}, 'queued', 'SYZYGY estimate: not measured by Qloo')
      on conflict (a_id, b_id) do nothing returning id`) as { id: string }[];
    inserted += r.length;
  }
  return { candidates: found.length, kept: keep.length, inserted, pitch: keep.filter(k => k.m.score >= EST_CUTOFFS.pitch).length };
}
