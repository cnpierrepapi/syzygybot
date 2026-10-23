// A live desk run. Opening a desk starts one (or joins the one already going): the agents read the persona's audience in
// Qloo live, pick the brands that audience leans toward, and carry each card across the board as they work. Every step is
// logged the moment it happens (ref run_cards), so the board and the floor show the run as it goes. A card ends as a
// permission request in Your approval; nothing is sent by a run.
import { sql } from "../db";
import { logAction, type Agent } from "../actions";
import { persona, type Persona } from "../personas";
import { qlooCallsMade } from "../qloo";
import { syzygyMatch, tagLabel } from "../match";
import { clear, countryFromRole, countryOf } from "../clearance";
import { slugify, token } from "../slug";
import { draft, findBuyer, findInbox, talentDeals, type Purpose } from "../desks/common";
import { PLANS, type Lane } from "./plans";
import { affinities, audienceInsights, profile, resolve, sideOf, top, type Ent, type Insights } from "./qx";
import { metroOf } from "../geo";

const JOIN_MIN = 15;          // a run still going after this long is treated as stuck
const REUSE_MIN = 3;          // a visit right after a run finished shows that run instead of starting another
const DAILY_RUNS = 120;       // all personas together; each run costs about $0.30 of model calls
const POOL = 16;              // candidates scored per lane (ours vs Qloo's)
const BUYER_MS = 100_000, INBOX_MS = 60_000;

export const COL = { spotted: 0, checked: 1, person: 2, drafted: 3, clearance: 4, approval: 5 } as const;

const within = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>(r => setTimeout(() => r(fallback), ms))]);

/** The run a visitor should watch: the one going now, one that just finished, or a new one. */
export async function startOrJoin(personaId: string, trigger: "visit" | "warm" | "again") {
  await sql()`update runs set status = 'failed', error = 'stopped answering', finished_at = now()
    where status = 'running' and started_at < now() - make_interval(mins => ${JOIN_MIN})`;
  const [cur] = (await sql()`select id, status, finished_at from runs where persona = ${personaId}
    and (status = 'running' or (${trigger} = 'visit' and finished_at > now() - make_interval(mins => ${REUSE_MIN})))
    order by started_at desc limit 1`) as { id: string; status: string }[];
  if (cur) return { id: cur.id, fresh: false };
  const [{ n }] = (await sql()`select count(*)::int n from runs where started_at > now() - interval '1 day'`) as { n: number }[];
  if (n >= DAILY_RUNS) return { id: null, fresh: false, why: "Today's live runs are used up. The board shows the last one." };
  // One running row per persona, even when two visitors arrive in the same second.
  const [row] = (await sql()`insert into runs (persona, trigger) select ${personaId}, ${trigger}
    where not exists (select 1 from runs where persona = ${personaId} and status = 'running') returning id`) as { id: string }[];
  if (!row) return startOrJoin(personaId, trigger);
  return { id: row.id, fresh: true };
}

type Card = { id: string; desk: string };

async function step(runId: string, p: Persona, card: Card | null, col: number | null, agent: Agent, kind: string, summary: string, extra: Record<string, unknown> = {}, cost?: number) {
  await logAction({ agent, kind, summary, refTable: card ? "run_cards" : "runs", refId: card?.id ?? runId, llmCostUsd: cost,
    detail: { run: runId, persona: p.id, desk: card?.desk ?? null, col, ...extra } });
}

/** Spearman rank correlation, for "how close are our scores to Qloo's ranking". */
export function spearman(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 4) return null;
  const rank = (v: number[]) => { const o = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]); const r = new Array(n); o.forEach(([, i], k) => (r[i] = k)); return r as number[]; };
  const rx = rank(xs), ry = rank(ys);
  const d2 = rx.reduce((s, r, i) => s + (r - ry[i]) ** 2, 0);
  return +(1 - (6 * d2) / (n * (n * n - 1))).toFixed(2);
}

export async function execute(runId: string) {
  const [run] = (await sql()`select id, persona from runs where id = ${runId}`) as { id: string; persona: string }[];
  const p = run && persona(run.persona), plan = run && PLANS[run.persona];
  if (!p || !plan) return;
  const calls0 = qlooCallsMade();
  let cost = 0;
  try {
    const subject = (await Promise.all(plan.lanes[0].signal.map(s => resolve(s.name, s.type)))).filter((e): e is Ent => !!e);
    if (!subject.length) throw new Error(`Qloo has no record for ${plan.lanes[0].signal[0].name}`);
    // Where the audience is strongest, from its own heatmap; the plan's city if Qloo has none.
    const cells = (await profile(subject[0].id)).cells;
    const city = cells.map(c => metroOf(c)).find(Boolean) ?? plan.city;
    await step(runId, p, null, null, "scout", "run.started",
      `Live run for ${p.title}. The agents are reading ${subject.map(s => s.name).join(" and ")}'s audience in Qloo now.`);
    const ins: Insights = await audienceInsights(subject.map(s => s.id), city);
    const self = new Set(subject.map(s => s.name.toLowerCase()));
    ins.people = ins.people.filter(n => !self.has(n.toLowerCase()));
    await sql()`update runs set insights = ${JSON.stringify(ins)} where id = ${runId}`;
    const groups = ins.audiences.slice(0, 3).map(a => a.name);
    await step(runId, p, null, null, "numbers", "run.audience",
      `Qloo, live: ${subject[0].name}'s fans also follow ${ins.people.slice(0, 3).join(", ") || "no one Qloo lists"}` +
      `${groups.length ? `, and over-index on ${groups.join(", ")}` : ""}${ins.local.length ? `. In ${city} they lean toward ${ins.local.slice(0, 3).map(l => l.name).join(", ")}` : ""}.`);

    const taken = new Set(((await sql()`select target->>'org' org from permission_requests where persona = ${p.id}`) as { org: string }[]).map(r => r.org.toLowerCase()));
    for (const b of p.brands ?? []) taken.add(b.toLowerCase());
    const jobs: (() => Promise<void>)[] = [];
    for (const lane of plan.lanes) {
      const sig = (await Promise.all(lane.signal.map(s => resolve(s.name, s.type)))).filter((e): e is Ent => !!e);
      if (!sig.length) continue;
      const pool = (await top(sig.map(s => s.id), "brand", 40, lane.tags)).filter(c => !taken.has(c.name.toLowerCase())).slice(0, POOL);
      if (!pool.length) continue;
      const me = await sideOf(sig[0]);
      // Qloo measures each pair both ways: how much these fans like the brand (free with the list), and how much the brand's
      // own audience likes them back (one call per brand, cached). The weaker of the two is the pair's two-way score.
      const backs = await Promise.all(pool.map(c => affinities([c.id], [sig[0].id], sig[0].type).then(m => m.get(sig[0].id) ?? null).catch(() => null)));
      const scored: Scored[] = [];
      for (const [i, c] of pool.entries()) {
        const back = backs[i], twoWay = c.affinity != null && back != null ? Math.min(c.affinity, back) : null;
        scored.push({ c, back, twoWay, m: await syzygyMatch(me, await sideOf(c)) });
      }
      // How close our estimate is to Qloo's own measurement, for every brand this lane looked at.
      for (const { c, m, back } of scored) {
        await sql()`insert into estimate_checks (source, run_id, a_id, b_id, a_name, b_name, ours, qloo_toward, qloo_back)
          values ('run', ${runId}, ${sig[0].id}, ${c.id}, ${sig[0].name}, ${c.name}, ${m.score}, ${c.affinity}, ${back})
          on conflict (source, a_id, b_id) do update set run_id = excluded.run_id, ours = excluded.ours, qloo_toward = excluded.qloo_toward,
            qloo_back = excluded.qloo_back, created_at = now()`;
      }
      const both = scored.filter(s => s.twoWay != null);
      const rho = spearman(both.map(s => s.m.score), both.map(s => s.twoWay!));
      await step(runId, p, null, null, "numbers", "run.compared",
        `Measured ${both.length} brands both ways in Qloo for ${sig.map(s => s.name).join(" and ")}'s fans. Our score vs Qloo's ranking: ${rho == null ? "too few to compare" : `${rho} rank correlation`}.`,
        { lane: `${lane.desk}:${lane.speaker}`, rho, n: both.length });
      // Qloo's two-way measurement picks; our score breaks ties and rides along on the card.
      const ranked = [...scored].sort((a, b) => (b.twoWay ?? -1) - (a.twoWay ?? -1) || b.m.score - a.m.score);
      const picks = ranked.slice(0, lane.n);
      for (const { c } of picks) taken.add(c.name.toLowerCase());
      for (const s of picks) jobs.push(() => carry(runId, p, lane, sig, s, ranked.indexOf(s), ranked.length).then(x => { cost += x; }));
    }
    // Two cards in flight at a time: fast enough to finish in a few minutes, slow enough to stay inside the model quotas.
    const queue = [...jobs];
    await Promise.all([0, 1].map(async () => { while (queue.length) await queue.shift()!(); }));
    await sql()`update runs set status = 'done', finished_at = now(), qloo_calls = ${qlooCallsMade() - calls0}, cost_usd = ${cost} where id = ${runId}`;
    const [{ n }] = (await sql()`select count(*)::int n from run_cards where run_id = ${runId} and status = 'done'`) as { n: number }[];
    await step(runId, p, null, null, "sequencer", "run.finished", `Run finished: ${n} ${n === 1 ? "card is" : "cards are"} waiting for your approval. The report is ready.`);
  } catch (e) {
    await sql()`update runs set status = 'failed', finished_at = now(), error = ${(e as Error).message.slice(0, 300)}, qloo_calls = ${qlooCallsMade() - calls0}, cost_usd = ${cost} where id = ${runId}`;
    await step(runId, p, null, null, "scout", "run.failed", `The run stopped early: ${(e as Error).message.slice(0, 140)}.`);
  }
}

/** One card, Spotted to Your approval. Returns what its model calls cost. */
// Place keywords and tags nearly every show carries ("Actor", "Love") say nothing about why two audiences fit.
const PLACE_TAG = /\b(city|california|new york|los angeles|texas|florida|chicago|atlanta|miami|london|paris|tokyo|puerto rico|new jersey|georgia|ohio|spain|madrid|england|italy|france|japan|korea|brazil|colombia)\b|^(actor|actress|love|secret|family relationships|friendship|21st century|female protagonist|male protagonist|based on a true story|celebrity)$/i;

type Scored = { c: Ent & { affinity: number | null }; back: number | null; twoWay: number | null; m: Awaited<ReturnType<typeof syzygyMatch>> };

async function carry(runId: string, p: Persona, lane: Lane, sig: Ent[], s: Scored, rank: number, of: number) {
  const { c } = s;
  const title = lane.title(c.name);
  const [row] = (await sql()`insert into run_cards (run_id, persona, desk, title, org, entity_id) values (${runId}, ${p.id}, ${lane.desk}, ${title}, ${c.name}, ${c.id}) returning id`) as { id: string }[];
  const card = { id: row.id, desk: lane.desk };
  // A card that fails (a model call timing out, a page that won't load) is dropped on its own; the run carries on.
  try { return await carryCard(runId, p, lane, sig, s, rank, of, card, title); }
  catch (e) {
    await sql()`update run_cards set status = 'dropped', detail = ${JSON.stringify({ why: (e as Error).message.slice(0, 200) })} where id = ${card.id}`;
    await step(runId, p, card, null, "sequencer", "card.dropped", `Dropped ${c.name}: an agent ran out of time on it. The next run tries again.`);
    return 0;
  }
}

async function carryCard(runId: string, p: Persona, lane: Lane, sig: Ent[], s: Scored, rank: number, of: number, card: Card, title: string) {
  const { c, m, back } = s;
  const fans = sig.map(s => s.name).join(" and ");
  await step(runId, p, card, COL.spotted, lane.agent, "card.spotted",
    `${fans}'s fans lean toward ${c.name}: ${c.affinity?.toFixed(2) ?? "n/a"} on Qloo, measured live. Number ${rank + 1} of ${of} once Qloo measured both ways.`);

  // Checked: our score next to Qloo's two-way numbers, and the talent's known deals.
  const deals = lane.talent ? await talentDeals(lane.talent) : [];
  const clash = deals.find(d => d.brand.toLowerCase() === c.name.toLowerCase());
  if (clash) {
    await sql()`update run_cards set status = 'dropped', detail = ${JSON.stringify({ why: "existing deal", deal: clash })} where id = ${card.id}`;
    await step(runId, p, card, COL.checked, "checker", "card.dropped", `Deal check: ${lane.talent} already works with ${c.name} (${clash.year ?? "recent"}). Not pitching.`);
    return 0;
  }
  // Place keywords ("Los angeles california") are where a show is set, not a taste; the cities line covers geography.
  const shared = m.sharedTags.filter(t => !PLACE_TAG.test(t)).slice(0, 3).map(tagLabel);
  await step(runId, p, card, COL.checked, "numbers", "card.checked",
    `Our match score ${m.score}/100 (${m.strength}). Qloo both ways: ${c.affinity?.toFixed(2) ?? "n/a"} toward ${c.name}, ${back?.toFixed(2) ?? "n/a"} back.` +
    `${shared.length ? ` Shared tastes: ${shared.join(", ")}.` : ""}${deals.length ? " No clash with known deals." : ""}`,
    { ours: m.score, toward: c.affinity, back });
  await sql()`update estimate_checks set qloo_back = ${back} where source = 'run' and a_id = ${sig[0].id} and b_id = ${c.id}`;

  // Person found: who decides there, confirmed on pages we read ourselves; their published inbox as the route.
  const site = c.site;
  const [buyer, inbox] = await Promise.all([
    within(findBuyer(c.name, site, lane.purpose as Purpose, "US", { hunter: false, sweep: false }), BUYER_MS, null),
    within(findInbox(c.name, site, lane.purpose as Purpose), INBOX_MS, { email: null, url: null, postal: null, status: "not_found", cost: 0 }),
  ]);
  const dom = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  await step(runId, p, card, COL.person, "contact_finder", "card.person",
    buyer ? `Found who decides: ${buyer.name}, ${buyer.role}, confirmed on ${dom(buyer.page)}.${inbox.email ? " Their published inbox is the route." : " It goes by post."}`
      : `No named person confirmed in time. It goes to ${inbox.email ? `${c.name}'s published inbox` : `${c.name}'s office by post`}.`,
    { person: buyer?.name ?? null, page: buyer?.page ?? null });

  // Drafted.
  // The pitch leads with Qloo's measurement; our score only goes in when it agrees (a weak score stays on the board).
  const facts = [
    ...(m.strength !== "weak" ? [`Our match score between ${fans}'s audience and ${c.name}'s: ${m.score} out of 100 (${m.strength}).`] : []),
    `Qloo's taste data, read today: ${fans}'s audience leans toward ${c.name} at ${c.affinity?.toFixed(2) ?? "n/a"}${back != null ? `, and ${c.name}'s audience back at ${back.toFixed(2)}` : ""} (0 to 1).`,
    ...(shared.length ? [`Shared audience tastes: ${shared.join(", ")}.`] : []),
    ...(m.sharedCities.length ? [`Both audiences concentrate in ${m.sharedCities.slice(0, 3).join(", ")}.`] : []),
  ];
  const viaInbox = !!buyer && !!inbox.email;
  const d = await draft({ kind: lane.ask(c.name), sender: p.title, facts, recipient: c.name,
    ...(buyer ? { recipient_person: { name: buyer.name, role: buyer.role }, ...(viaInbox ? { delivered_via: `the organisation's published inbox, marked for ${buyer.name}'s attention` } : {}) } : {}) });
  const spent = d.cost + (inbox.cost ?? 0);
  if (!d.draft) {
    await sql()`update run_cards set status = 'dropped', detail = ${JSON.stringify({ why: "draft broke a rule twice" })} where id = ${card.id}`;
    await step(runId, p, card, COL.drafted, "writer", "card.dropped", `Dropped: the draft to ${c.name} broke a writing rule twice.`, {}, spent);
    return spent;
  }
  const channel = inbox.email ? "email" : "letter";
  await step(runId, p, card, COL.drafted, "writer", "card.drafted",
    `Drafted ${channel === "email" ? "an email" : "a letter"} to ${buyer ? `${buyer.name} at ` : ""}${c.name}: "${d.draft.subject}".`, {}, spent);

  // Clearance.
  const country = countryFromRole(buyer?.role) ?? countryOf(inbox.email, "US");
  const clearance = await clear({ channel, subject: d.draft.subject, body: d.draft.body, address: inbox.email, addressSource: inbox.email ? "published" : null,
    roleStatus: buyer ? "confirmed" : null, country, talent: lane.talent ? [lane.talent] : [], targetBrand: c.name, talentDeals: deals, usesQloo: true });
  const held = clearance.checks.filter(x => !x.pass);
  await step(runId, p, card, COL.clearance, "clearance", held.length ? "card.held" : "card.cleared",
    held.length ? `Held. ${held.map(h => h.note).join(" ")}` : `Cleared on all ${clearance.checks.length} rules.`);

  // Your approval: filed as a permission request, like every desk card.
  const target = { org: c.name, site, person: buyer?.name ?? null, role: buyer?.role ?? null, roleStatus: buyer ? "confirmed" : null, personSource: buyer?.page ?? null,
    address: inbox.email, source: inbox.url, postal: inbox.postal, channel, country, talent: lane.talent ? [lane.talent] : [], brand: c.name, purpose: lane.purpose };
  const evidence = { match: { ...m, qloo: c.affinity != null && back != null ? { toward: +c.affinity.toFixed(3), back: +back.toFixed(3), band: "live" } : null }, facts };
  const [req] = (await sql()`
    insert into permission_requests (persona, desk, action, title, target, preview, evidence, clearance, dedupe, ref_table, ref_id, slug, run_id)
    values (${p.id}, ${lane.desk}, ${lane.action}, ${title}, ${JSON.stringify(target)}, ${JSON.stringify(d.draft)}, ${JSON.stringify(evidence)},
      ${JSON.stringify(clearance)}, ${`${p.id}|${lane.desk}|live|${lane.speaker}|${c.id}`}, 'run_cards', ${card.id}, ${`${slugify(title, 50)}-${token(4).toLowerCase()}`}, ${runId})
    on conflict (dedupe) do nothing returning id`) as { id: string }[];
  await sql()`update run_cards set status = 'done', request_id = ${req?.id ?? null} where id = ${card.id}`;
  await step(runId, p, card, COL.approval, lane.agent, "card.filed",
    held.length ? `Filed for you, held until the Clearance note is fixed.` : `Waiting for your approval.`, { request: req?.id ?? null });
  return spent;
}

export type RunStep = { col: number | null; agent: string; kind: string; summary: string; at: string; detail: Record<string, unknown> };
export type RunCard = { id: string; desk: string; title: string; org: string; status: string; request_id: string | null; steps: RunStep[] };
export type RunSnapshot = { id: string; persona: string; status: string; started_at: string; finished_at: string | null; qloo_calls: number; error: string | null; log: RunStep[]; cards: RunCard[] };

/** The run as the board polls it: every card with its steps so far, and the run-level lines. */
export async function snapshot(runId: string): Promise<RunSnapshot | null> {
  const [r] = (await sql()`select id, persona, status, started_at, finished_at, qloo_calls, error from runs where id = ${runId}`) as Omit<RunSnapshot, "log" | "cards">[];
  if (!r) return null;
  const cards = (await sql()`select id, desk, title, org, status, request_id from run_cards where run_id = ${runId} order by created_at`) as Omit<RunCard, "steps">[];
  const acts = (await sql()`select ref_table, ref_id, agent, kind, summary, created_at at, detail from actions
    where detail->>'run' = ${runId} order by created_at`) as (RunStep & { ref_table: string; ref_id: string })[];
  const strip = ({ ref_table: _t, ref_id: _i, ...s }: RunStep & { ref_table: string; ref_id: string }) => ({ ...s, col: (s.detail?.col as number | null) ?? null, at: new Date(s.at).toISOString() });
  return {
    ...r, started_at: new Date(r.started_at).toISOString(), finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    log: acts.filter(a => a.ref_table === "runs").map(strip),
    cards: cards.map(c => ({ ...c, steps: acts.filter(a => a.ref_table === "run_cards" && a.ref_id === c.id).map(strip) })),
  };
}

export async function latestRun(personaId: string) {
  const [r] = (await sql()`select id from runs where persona = ${personaId} order by started_at desc limit 1`) as { id: string }[];
  return r?.id ?? null;
}
