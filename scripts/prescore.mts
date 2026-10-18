// npm run prescore            -> fill the seed pool, then sweep until every seed is scored (no time limit)
// npm run prescore -- status  -> queue and seed counts, and the next pairs Scout would pick
import { sql } from "../lib/db";
import { excludedIds, fillSeeds, runPrescore } from "../lib/prescore";

if (process.argv[2] === "status") {
  console.log(await sql()`select status, band, count(*)::int n from pair_queue group by 1, 2 order by 1, 2`);
  console.log(await sql()`select count(*) filter (where swept_at is null)::int unswept, count(*)::int seeds from scout_seeds`);
  const ex = await excludedIds();
  const next = (await sql()`select a->>'name' a, b->>'name' b, a_id, b_id, band, round(score::numeric, 3) score from pair_queue where status = 'queued' order by (band = 'PITCH') desc, score desc limit 40`) as { a: string; b: string; a_id: string; b_id: string; band: string; score: number }[];
  console.log(`${ex.size} brands excluded. Next up:`);
  for (const r of next.filter(r => !ex.has(r.a_id) && !ex.has(r.b_id)).slice(0, 10)) console.log(`  ${r.band} ${r.score}  ${r.a} × ${r.b}`);
} else {
  await fillSeeds();
  for (;;) {
    const r = await runPrescore(10 * 60_000);
    for (const s of r) console.log(`${s.seed}: ${JSON.stringify(s.counts)}${s.stopped ? ` STOPPED: ${s.stopped}` : s.done ? "" : " (cut off, resumes)"}`);
    if (!r.length || r.some(s => s.stopped)) break;
  }
}
