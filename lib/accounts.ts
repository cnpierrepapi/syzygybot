// Qualifier + Numbers analyst.
// Qualifier: of the two sides of a pair, pick the ONE that would buy Qloo. The other is evidence only.
// Numbers: build that account's evidence pack, plus three more partners Qloo finds for it,
// so the pitch sells Qloo's breadth rather than one deal.

import { sql } from "./db";
import { fillSlugs } from "./slug";
import { logAction } from "./actions";
import { ask } from "./llm";
import { metros } from "./geo";
import { demographics, pull, topFor, type EntityType, type QlooEntity } from "./qloo";
import { ageVector } from "./scout";
import { safeTags } from "./match";
import type { Raw } from "./rubric";
import type { Estimate } from "./estimate";

// Who has a marketing/partnerships budget and an insights team. Studios are brand entities in Qloo.
const BUYER: Record<string, number> = { brand: 1, tv_show: 0.5, artist: 0.3 };

type Side = { qloo_id: string; name: string; type: string; popularity: number | null; x_handle: string | null; x_handle_status: string; official_site: string | null };

type PairRow = {
  id: string; score: number; band: string; thesis: string | null;
  dims: { raw: Raw; estimate?: Estimate };
  a: Side; b: Side;
};

const clamp = (x: number) => Math.min(1, Math.max(0, x));

export function qualify(p: PairRow) {
  const r = p.dims.raw;
  const sameType = p.a.type === p.b.type;
  const side = (self: Side, other: Side, pullIn: number | null) => {
    const buyer = BUYER[self.type] ?? 0.2;
    // Gain: how much the other side's audience already likes this one, i.e. fans it could win.
    // Same-type pulls are symmetric, so the smaller brand is the one that gains from the bigger.
    const gain = sameType
      ? clamp(0.5 + ((other.popularity ?? 0) - (self.popularity ?? 0)) * 5)
      : clamp(((pullIn ?? 0.6) - 0.6) / 0.35);
    const scale = clamp(self.popularity ?? 0);
    const reach = self.x_handle_status === "verified" || self.official_site ? 1 : 0.5;
    const score = 0.5 * buyer + 0.2 * gain + 0.15 * scale + 0.15 * reach;
    return { score, factors: { buyer, gain, scale, reach } };
  };
  const sa = side(p.a, p.b, r.pullBA);
  const sb = side(p.b, p.a, r.pullAB);
  const pickA = sa.score >= sb.score;
  return {
    chosen: pickA ? p.a : p.b,
    passed: pickA ? p.b : p.a,
    scores: { [p.a.name]: sa, [p.b.name]: sb },
  };
}

const REASON_SYSTEM = `You are the Qualifier on an autonomous sales team built on Qloo taste data.
Write two plain sentences: why the chosen side is the one to approach about Qloo's audience data,
and why the other side is kept as evidence only. Use only the facts given. Never claim a budget,
team or deal is confirmed; say what the facts suggest. No hype words, no em dashes.`;

function plainFacts(q: ReturnType<typeof qualify>) {
  const f = (s: Side) => q.scores[s.name].factors;
  const say = (s: Side) => ({
    name: s.name,
    kind: s.type === "brand" ? "a brand or studio, the kind of business that buys audience data" : s.type === "tv_show" ? "a TV show (the buyer would be its network)" : "an individual artist (the buyer would be a label or management)",
    other_audience_already_likes_it: f(s).gain >= 0.6 ? "strongly" : f(s).gain >= 0.3 ? "moderately" : "weakly",
    public_contact_route: f(s).reach === 1 ? "verified" : "not verified yet",
  });
  return { chosen: say(q.chosen), evidence_only: say(q.passed) };
}

const NUMBERS_PER_RUN_CANDIDATES = 6;

/** More partners for the account from the pre-scored queue: both pulls are already measured there. */
async function storedPartners(chosen: Side, exclude: string[]) {
  const rows = (await sql()`
    select a_id, b_id, a, b, dims->'raw' raw from pair_queue
    where ${chosen.qloo_id} in (a_id, b_id)`) as {
      a_id: string; b_id: string; a: QlooEntity; b: QlooEntity; raw: { pullAB: number | null; pullBA: number | null } | null;
    }[];
  return rows.filter(r => r.raw).map(r => {
    const chosenIsA = r.a_id === chosen.qloo_id, other = chosenIsA ? r.b : r.a;
    const o = (chosenIsA ? r.raw!.pullAB : r.raw!.pullBA) ?? 0, k = (chosenIsA ? r.raw!.pullBA : r.raw!.pullAB) ?? 0;
    return { entity_id: other.entity_id, name: other.name, type: (other.types?.[0] ?? "").split(":").pop() ?? "", pullOut: o, pullBack: k, min: Math.min(o, k) };
  }).filter(x => !exclude.includes(x.entity_id)).sort((x, y) => y.min - x.min).slice(0, 3);
}

async function morePartners(chosen: Side, exclude: string[]) {
  const types: EntityType[] = chosen.type === "brand" ? ["artist", "tv_show"] : ["brand"];
  // Insights results carry no `types`, so remember which list each candidate came from.
  const pool: { e: QlooEntity; t: EntityType }[] = [];
  for (const t of types) pool.push(...(await topFor([chosen.qloo_id], t, 30)).slice(10, 30).map(e => ({ e, t })));
  const picks = pool.filter(x => !exclude.includes(x.e.entity_id));
  const step = Math.max(1, Math.floor(picks.length / NUMBERS_PER_RUN_CANDIDATES));
  const sample = picks.filter((_, i) => i % step === 0).slice(0, NUMBERS_PER_RUN_CANDIDATES);
  const scored = [];
  for (const { e, t } of sample) {
    const [out, back] = await Promise.all([
      pull([chosen.qloo_id], e.entity_id, t),
      pull([e.entity_id], chosen.qloo_id, chosen.type as EntityType),
    ]);
    const o = out?.affinity ?? 0, k = back?.affinity ?? 0;
    scored.push({ entity_id: e.entity_id, name: e.name, type: t, pullOut: o, pullBack: k, min: Math.min(o, k) });
  }
  return scored.sort((x, y) => y.min - x.min).slice(0, 3);
}

export async function buildAccount(p: PairRow) {
  const q = qualify(p);
  const facts = plainFacts(q);
  let reason: { text: string; model: string; costUsd: number | null };
  try { reason = await ask("fast", REASON_SYSTEM, JSON.stringify(facts), 200); }
  catch (e) {
    const f = q.scores[q.chosen.name].factors;
    reason = {
      text: `${q.chosen.name} is the buyer: buyer fit ${f.buyer.toFixed(2)}, gain ${f.gain.toFixed(2)}, scale ${f.scale.toFixed(2)}, reach ${f.reach.toFixed(2)}. ${q.passed.name} stays as evidence.`,
      model: `fallback (${(e as Error).message.slice(0, 60)})`, costUsd: null,
    };
  }

  // One account per company. A later thesis about a company we already work joins that account as extra evidence.
  const [existing] = (await sql()`select id from accounts where entity_id = ${q.chosen.qloo_id} order by created_at limit 1`) as { id: string }[];
  if (existing) {
    const extra = { pair_id: p.id, partner: q.passed.name, score: p.score, band: p.band, thesis: p.thesis };
    await sql()`update accounts set evidence = jsonb_set(evidence, '{otherTheses}', coalesce(evidence->'otherTheses', '[]'::jsonb) || ${JSON.stringify([extra])}::jsonb) where id = ${existing.id}`;
    await sql()`update pairs set account_id = ${existing.id} where id = ${p.id}`;
    await logAction({
      agent: "qualifier", kind: "account.extended",
      summary: `${q.chosen.name} is already an account; the ${q.chosen.name} × ${q.passed.name} thesis joins it as more evidence.`,
      refTable: "accounts", refId: existing.id, llmCostUsd: reason.costUsd,
    });
    return { accountId: existing.id, isNew: false, chosen: q.chosen.name, passed: q.passed.name, partners: [] as string[] };
  }

  const rows = (await sql()`
    insert into accounts (pair_id, entity_id, reason, passed_on, evidence)
    values (${p.id}, ${q.chosen.qloo_id}, ${reason.text}, ${q.passed.qloo_id}, ${JSON.stringify({ qualifier: q.scores })})
    returning id`) as { id: string }[];
  const accountId = rows[0].id;
  await sql()`update pairs set account_id = ${accountId} where id = ${p.id}`;
  await logAction({
    agent: "qualifier", kind: "account.qualified",
    summary: `Chose ${q.chosen.name} as the buyer; ${q.passed.name} is evidence only.`,
    refTable: "accounts", refId: accountId, detail: { model: reason.model }, llmCostUsd: reason.costUsd,
  });

  // Numbers analyst.
  const r = p.dims.raw;
  const chosenIsA = q.chosen.qloo_id === p.a.qloo_id;
  const sharedCells = r.cellsA.filter(c => r.cellsB.includes(c));
  // Stored numbers first (the pair's own age data, other queued pairs for this company); Qloo only fills a gap.
  const storedAge = chosenIsA ? r.ageA : r.ageB;
  const stored = await storedPartners(q.chosen, [p.a.qloo_id, p.b.qloo_id]);
  const [demo, partners] = await Promise.all([
    storedAge ? Promise.resolve(null) : demographics([q.chosen.qloo_id]).catch(() => null),
    stored.length >= 3 ? Promise.resolve(stored) : morePartners(q.chosen, [p.a.qloo_id, p.b.qloo_id]).catch(() => stored),
  ]);
  const evidence = {
    qualifier: q.scores,
    pair: { score: p.score, band: p.band, thesis: p.thesis },
    pull: { partnerFansLikeAccount: chosenIsA ? r.pullBA : r.pullAB, accountFansLikePartner: chosenIsA ? r.pullAB : r.pullBA },
    // A SYZYGY estimate carries our match score instead of Qloo pulls; the partners below are still Qloo-measured.
    estimate: p.dims.estimate ?? null,
    sharedTaste: safeTags(p.dims.estimate?.sharedTags ?? r.tagsA.filter(t => r.tagsB.includes(t))).slice(0, 12),
    cities: { shared: p.dims.estimate?.sharedCities ?? metros(sharedCells), account: metros(chosenIsA ? r.cellsA : r.cellsB).slice(0, 8) },
    audienceAge: storedAge ?? ageVector(demo),
    morePartners: partners,
    source: p.dims.estimate
      ? "SYZYGY match score from patterns in Qloo taste data (this pair not measured by Qloo); more partners are Qloo-measured. Aggregate audiences; not causal."
      : "Qloo taste data (hackathon API). Aggregate audience affinity; not causal.",
  };
  await sql()`update accounts set evidence = ${JSON.stringify(evidence)} where id = ${accountId}`;
  await logAction({
    agent: "numbers", kind: "evidence.built",
    summary: `Evidence pack for ${q.chosen.name}: ${evidence.cities.shared.length} shared cities, ${partners.length} more partners (${partners.map(x => x.name).join(", ") || "none"}).`,
    refTable: "accounts", refId: accountId,
  });
  return { accountId, isNew: true, chosen: q.chosen.name, passed: q.passed.name, partners: partners.map(x => x.name) };
}

/** Qualify the best unqualified pairs, PITCH before WATCH. */
export async function runAccounts(limit = 2) {
  const pairs = (await sql()`
    select p.id, p.score, p.band, p.thesis, p.dims,
      row_to_json(a) as a, row_to_json(b) as b
    from pairs p
    join (select qloo_id, name, type, popularity, x_handle, x_handle_status, official_site from entities) a on a.qloo_id = p.a_id
    join (select qloo_id, name, type, popularity, x_handle, x_handle_status, official_site from entities) b on b.qloo_id = p.b_id
    -- Deal check first: a thesis that is already a live partnership never becomes an account.
    where p.band in ('PITCH','WATCH') and p.deal_status in ('clear','past') and p.account_id is null and not exists (select 1 from accounts ac where ac.pair_id = p.id)
    order by (p.band = 'PITCH') desc, p.score desc
    limit ${limit}`) as PairRow[];
  const out = [];
  for (const p of pairs) {
    try { out.push(await buildAccount(p)); }
    catch (e) {
      await logAction({ agent: "qualifier", kind: "account.error", summary: `Could not qualify ${p.a.name} × ${p.b.name}.`, detail: { error: (e as Error).message.slice(0, 300) } });
    }
  }
  if (out.length) await fillSlugs();
  return out;
}
