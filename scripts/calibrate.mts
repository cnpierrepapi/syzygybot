// npm run calibrate            -> how close SYZYGY's estimates are to Qloo's own measurement
// 1. The pairs we only estimated (rubric syzygy-est-1) get measured in Qloo now, both ways, batched by signal.
// 2. Every measured pair in the corpus gets our match score next to Qloo's two numbers (no calls).
// Both land in estimate_checks (source 'backfill'); the summary prints rank correlations and band agreement.
import { sql } from "../lib/db";
import { affinities } from "../lib/live/qx";
import { loadCorpus } from "../lib/corpus";
import { sideOf, syzygyMatch } from "../lib/match";
import { spearman } from "../lib/live/run";
import { qlooCallsLeft, qlooCallsMade, type EntityType, type QlooEntity } from "../lib/qloo";

type Row = { a_id: string; b_id: string; a: QlooEntity; b: QlooEntity; band: string; dims: { estimate?: { score: number }; raw?: { pullAB?: number; pullBA?: number } } };
const typeOf = (e: QlooEntity) => ((e.types?.[0] ?? "urn:entity:brand").split(":").pop() as EntityType);
const by = <T,>(xs: T[], k: (x: T) => string) => xs.reduce((m, x) => m.set(k(x), [...(m.get(k(x)) ?? []), x]), new Map<string, T[]>());

const est = (await sql()`select a_id, b_id, a, b, band, dims from pair_queue where rubric_version = 'syzygy-est-1'`) as Row[];
console.log(`${est.length} estimated pairs to measure in Qloo`);
const toward = new Map<string, number | null>(), back = new Map<string, number | null>();
for (const [a, rows] of by(est, r => r.a_id)) for (const [t, grp] of by(rows, r => typeOf(r.b)))
  for (const [id, v] of await affinities([a], grp.map(r => r.b_id), t)) toward.set(`${a}|${id}`, v);
for (const [b, rows] of by(est, r => r.b_id)) for (const [t, grp] of by(rows, r => typeOf(r.a)))
  for (const [id, v] of await affinities([b], grp.map(r => r.a_id), t)) back.set(`${id}|${b}`, v);
for (const r of est) {
  const k = `${r.a_id}|${r.b_id}`;
  await sql()`insert into estimate_checks (source, a_id, b_id, a_name, b_name, ours, qloo_toward, qloo_back)
    values ('backfill', ${r.a_id}, ${r.b_id}, ${r.a.name}, ${r.b.name}, ${r.dims.estimate?.score ?? 0}, ${toward.get(k) ?? null}, ${back.get(k) ?? null})
    on conflict (source, a_id, b_id) do update set ours = excluded.ours, qloo_toward = excluded.qloo_toward, qloo_back = excluded.qloo_back, created_at = now()`;
}

// Measured pairs: our score from the corpus, Qloo's numbers from the stored measurement.
const { profiles, edges } = await loadCorpus();
let measured = 0;
for (const [a, es] of edges) for (const e of es) {
  if (a > e.partnerId) continue;
  const pa = profiles.get(a), pb = profiles.get(e.partnerId);
  if (!pa || !pb || !pa.tags.size || !pb.tags.size) continue;
  const m = await syzygyMatch(sideOf(pa), sideOf(pb));
  await sql()`insert into estimate_checks (source, a_id, b_id, a_name, b_name, ours, qloo_toward, qloo_back)
    values ('backfill', ${a}, ${e.partnerId}, ${pa.name}, ${pb.name}, ${m.score}, ${e.toward}, ${e.back})
    on conflict (source, a_id, b_id) do update set ours = excluded.ours, qloo_toward = excluded.qloo_toward, qloo_back = excluded.qloo_back`;
  measured++;
}

const all = (await sql()`select a_id, b_id, ours, qloo_toward t, qloo_back b from estimate_checks where source = 'backfill' and qloo_toward is not null and qloo_back is not null`) as { a_id: string; b_id: string; ours: number; t: number; b: number }[];
const estKeys = new Set(est.map(r => `${r.a_id}|${r.b_id}`));
const report = (label: string, xs: typeof all) => {
  const two = xs.map(x => Math.min(x.t, x.b));
  // Qloo's numbers bunch up high (almost every measured pair is 0.70+), so "good" means Qloo's own top quarter of this set.
  const q75 = [...two].sort((a, b) => a - b)[Math.floor(two.length * 0.75)] ?? 1;
  const strongUs = xs.filter(x => x.ours >= 80);
  const hit = strongUs.filter(x => Math.min(x.t, x.b) >= q75).length;
  console.log(`\n${label}: ${xs.length} pairs`);
  console.log(`  rank correlation, our score vs Qloo two-way: ${spearman(xs.map(x => x.ours), two)}`);
  console.log(`  Qloo's top quarter starts at ${q75.toFixed(3)} two-way. Of the ${strongUs.length} we call strong (80+), ${hit} are in it (${strongUs.length ? Math.round((100 * hit) / strongUs.length) : 0}%, chance is 25%).`);
};
report("Estimates, now measured", all.filter(x => estKeys.has(`${x.a_id}|${x.b_id}`)));
report("Corpus pairs (measured before)", all.filter(x => !estKeys.has(`${x.a_id}|${x.b_id}`)));
console.log(`\n${measured} corpus pairs scored · ${qlooCallsMade()} Qloo calls · ${qlooCallsLeft()} left this month`);
