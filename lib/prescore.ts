// The pre-scored queue. The sweep scores every partner on each seed's Qloo list ahead of time
// (Qloo numbers only, no LLM), so Scout picks the best pair in the pool instead of whatever one
// seed's list throws up. A brand that has been pitched once (any thesis or account) never comes
// out of the queue again, and neither does anything on the hand-kept exclude list.

import { sql } from "./db";
import { logAction } from "./actions";
import { RUBRIC_VERSION, score, type Raw } from "./rubric";
import { entities, isQuotaError, qlooCallsLeft, search, topFor, type EntityType, type QlooEntity } from "./qloo";

// The sweep stops while this many of the month's Qloo calls are left (10,000 a month on the hackathon key),
// so Scout, Numbers and the Inbox agent always have calls to spend.
export const SWEEP_RESERVE = 4000;
import { LIST, PARTNER_TYPES, SEEDS, SKIP_TOP, measure, scorePair, typeOf, type Memo } from "./scout";

type QueueRow = { id: string; a_id: string; b_id: string; a: QlooEntity; b: QlooEntity; score: number; band: string; dims: { raw?: Raw } };

/** Brands already pitched (either side of a WATCH/PITCH pair, or an account) plus the exclude list. */
export async function excludedIds(): Promise<Set<string>> {
  const rows = (await sql()`
    select e.qloo_id id from entities e
    where e.type = 'brand' and (
      exists (select 1 from pairs p where p.band <> 'PASS' and e.qloo_id in (p.a_id, p.b_id))
      or exists (select 1 from accounts ac where e.qloo_id in (ac.entity_id, ac.passed_on)))
    union select entity_id from scout_exclude`) as { id: string }[];
  return new Set(rows.map(r => r.id));
}

/** The starting seeds plus every entity already in the database. Safe to run again. */
export async function fillSeeds() {
  for (const s of SEEDS) {
    const [e] = await search(s.name, s.type, 1);
    if (e) await sql()`insert into scout_seeds (entity_id, name, type, source) values (${e.entity_id}, ${e.name}, ${s.type}, 'seed') on conflict do nothing`;
  }
  await sql()`
    insert into scout_seeds (entity_id, name, type, source)
    select qloo_id, name, type, 'entities' from entities on conflict do nothing`;
}

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Scores one seed's whole list into the queue. Pairs already queued are skipped, so a cut-off run resumes. */
async function sweepSeed(seed: QlooEntity, excluded: Set<string>, memo: Memo, deadline: number) {
  const queued = new Set(((await sql()`
    select case when a_id = ${seed.entity_id} then b_id else a_id end id from pair_queue
    where a_id = ${seed.entity_id} or b_id = ${seed.entity_id}
    union select case when a_id = ${seed.entity_id} then b_id else a_id end from pairs
    where a_id = ${seed.entity_id} or b_id = ${seed.entity_id}`) as { id: string }[]).map(r => r.id));
  const counts = { PITCH: 0, WATCH: 0, PASS: 0 };
  for (const t of PARTNER_TYPES[typeOf(seed)] ?? ["brand"]) {
    const list = await topFor([seed.entity_id], t, LIST);
    const pool = list.filter(e => e.entity_id !== seed.entity_id).slice(SKIP_TOP)
      .filter(e => !queued.has(e.entity_id) && !excluded.has(e.entity_id));
    // Insights results lack some properties (industry); full records in batches of 20.
    const full = new Map<string, QlooEntity>();
    for (const ids of chunk(pool.map(e => e.entity_id), 20))
      for (const f of await entities(ids).catch(e => { if (isQuotaError(e)) throw e; return [] as QlooEntity[]; })) full.set(f.entity_id, f);
    for (const c0 of pool) {
      if (Date.now() > deadline) return { counts, done: false };
      const f = full.get(c0.entity_id);
      const c = f ? { ...c0, ...f, properties: { ...c0.properties, ...f.properties } } : c0;
      try {
        const raw = await measure(seed, c, memo);
        const s = score(raw);
        await sql()`
          insert into pair_queue (a_id, b_id, a, b, score, band, dims, rubric_version, status)
          values (${seed.entity_id}, ${c.entity_id}, ${JSON.stringify(seed)}, ${JSON.stringify(c)}, ${s.score}, ${s.band},
                  ${JSON.stringify({ raw, dims: s.dims, gate: s.gate })}, ${RUBRIC_VERSION}, ${s.band === "PASS" ? "skipped" : "queued"})
          on conflict (a_id, b_id) do nothing`;
        counts[s.band]++;
      } catch (e) {
        // Out of Qloo calls: stop here and leave the seed unswept. Anything else: skip this pair, retried next pass.
        if (isQuotaError(e)) throw e;
      }
    }
  }
  return { counts, done: true };
}

/** Sweeps unswept seeds until the time budget runs out. */
export async function runPrescore(budgetMs = 240_000) {
  const deadline = Date.now() + budgetMs, memo: Memo = new Map();
  const excluded = await excludedIds();
  const out: { seed: string; counts: Record<string, number>; done: boolean; stopped?: string }[] = [];
  const seeds = (await sql()`select entity_id, name, type from scout_seeds where swept_at is null order by (source = 'seed') desc, added_at`) as { entity_id: string; name: string; type: string }[];
  for (const s of seeds) {
    if (Date.now() > deadline) break;
    const left = qlooCallsLeft();
    if (left != null && left < SWEEP_RESERVE) {
      out.push({ seed: s.name, counts: { PITCH: 0, WATCH: 0, PASS: 0 }, done: false, stopped: `${left} Qloo calls left this month; the sweep keeps ${SWEEP_RESERVE} for the live agents` });
      break;
    }
    // A pitched brand can't be picked, so its list is no use as a seed.
    if (excluded.has(s.entity_id)) { await sql()`update scout_seeds set swept_at = now() where entity_id = ${s.entity_id}`; continue; }
    // A refused call is not an answer: a seed is only marked swept once Qloo has actually been asked.
    let seed: QlooEntity | undefined, r: Awaited<ReturnType<typeof sweepSeed>>;
    try {
      [seed] = await entities([s.entity_id]);
      if (!seed) { await sql()`update scout_seeds set swept_at = now() where entity_id = ${s.entity_id}`; continue; }
      if (!seed.types?.length) seed.types = [`urn:entity:${s.type}`];
      r = await sweepSeed(seed, excluded, memo, deadline);
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      out.push({ seed: s.name, counts: { PITCH: 0, WATCH: 0, PASS: 0 }, done: false, stopped: (e as Error).message });
      break;
    }
    if (r.done) await sql()`update scout_seeds set swept_at = now() where entity_id = ${s.entity_id}`;
    const n = r.counts.PITCH + r.counts.WATCH + r.counts.PASS;
    if (n) {
      const [{ waiting }] = (await sql()`select count(*)::int waiting from pair_queue where status = 'queued'`) as { waiting: number }[];
      await logAction({
        agent: "scout", kind: "queue.scored",
        summary: `Pre-scored ${n} partners from ${s.name}'s Qloo list: ${r.counts.PITCH} PITCH, ${r.counts.WATCH} WATCH queued (${waiting} waiting).`,
        detail: { entity_id: s.entity_id, ...r.counts, done: r.done },
      });
    }
    out.push({ seed: s.name, counts: r.counts, done: r.done });
  }
  return out;
}

/**
 * Takes the best queued pair (one per run, so each run tells one story down the chain) whose brand hasn't been pitched, scored from
 * its stored measurements with a thesis (scorePair), then adds both sides as seeds so the pool keeps growing. Empty if the queue is dry.
 */
export async function pickFromQueue(n = 1) {
  const excluded = await excludedIds();
  const rows = (await sql()`
    select id, a_id, b_id, a, b, score, band, dims from pair_queue where status = 'queued'
    order by (band = 'PITCH') desc, score desc limit 200`) as QueueRow[];
  const [{ waiting }] = (await sql()`select count(*)::int waiting from pair_queue where status = 'queued'`) as { waiting: number }[];
  const out = [];
  for (const r of rows) {
    if (out.length >= n) break;
    const hit = [r.a_id, r.b_id].find(id => excluded.has(id));
    if (hit) {
      await sql()`update pair_queue set status = 'skipped', note = 'brand already pitched' where id = ${r.id}`;
      continue;
    }
    await sql()`update pair_queue set status = 'picked', picked_at = now() where id = ${r.id}`;
    const pickedAction = await logAction({
      agent: "scout", kind: "queue.picked",
      summary: `Picked ${r.a.name} × ${r.b.name} from the queue: best of ${waiting - out.length} waiting (pre-score ${r.score.toFixed(2)} ${r.band}).`,
      detail: { entity_id: r.a_id, queue_id: r.id },
    });
    try {
      // The intake measured this pair today; use those numbers rather than spending Qloo calls again.
      const scored = await scorePair(r.a, r.b, r.dims.raw ? { raw: r.dims.raw } : undefined);
      await sql()`update pair_queue set pair_id = ${scored.pairId} where id = ${r.id}`;
      // The pick line on the floor opens the thesis it became.
      await sql()`update actions set ref_table = 'pairs', ref_id = ${scored.pairId} where id = ${pickedAction}`;
      out.push({ a: r.a.name, b: r.b.name, ...scored });
    } catch (e) {
      // Out of Qloo calls: undo the pick so the pair and its brand stay available, and stop. Nothing on the floor.
      if (isQuotaError(e)) {
        await sql()`update pair_queue set status = 'queued', picked_at = null where id = ${r.id}`;
        await sql()`delete from actions where id = ${pickedAction}`;
        throw e;
      }
      await logAction({ agent: "scout", kind: "pair.error", summary: `Could not score ${r.a.name} × ${r.b.name}.`, detail: { error: (e as Error).message.slice(0, 300) } });
    }
    // Both sides become seeds. A picked brand is never picked again, even if the live rescore passed it.
    for (const e of [r.a, r.b]) {
      await sql()`insert into scout_seeds (entity_id, name, type, source) values (${e.entity_id}, ${e.name}, ${typeOf(e) as EntityType}, 'picked') on conflict do nothing`;
      if (typeOf(e) !== "brand") continue;
      await sql()`insert into scout_exclude (entity_id, name, reason) values (${e.entity_id}, ${e.name}, 'picked by Scout') on conflict do nothing`;
      excluded.add(e.entity_id);
    }
  }
  return out;
}
