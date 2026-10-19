// npm run rebands  -> re-grade the queued pairs on the current cut-offs (no Qloo calls). Published pairs keep their grade.
import { sql } from "../lib/db";
import { CUTOFFS, RUBRIC_VERSION } from "../lib/rubric";
const r = await sql()`
  update pair_queue set
    band = case when dims->>'gate' is not null then 'PASS' when score >= ${CUTOFFS.pitch} then 'PITCH' when score >= ${CUTOFFS.watch} then 'WATCH' else 'PASS' end,
    rubric_version = ${RUBRIC_VERSION},
    status = case when status = 'queued' and not (dims->>'gate' is null and score >= ${CUTOFFS.watch}) then 'skipped' else status end
  where status in ('queued', 'skipped') returning band, status`;
const n: Record<string, number> = {};
for (const x of r as { band: string; status: string }[]) n[`${x.band}/${x.status}`] = (n[`${x.band}/${x.status}`] ?? 0) + 1;
console.log(n);
