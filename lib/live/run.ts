// A live desk run. Opening a desk starts one (or joins the one already going): the agents read the persona's audience in
// Qloo live, pick the brands that audience leans toward, and carry each card across the board as they work. Every step is
// logged the moment it happens (ref run_cards), so the board and the floor show the run as it goes. A card ends as a
// permission request in Your approval; nothing is sent by a run. Studio clearance runs a review instead: it walks the
// newest cards the other desks filed back through Clearance, live.
import { sql } from "../db";
import { logAction, type Agent } from "../actions";
import { loadPersona, type Persona } from "../personas";
import { qlooCallsMade } from "../qloo";
import { syzygyMatch, tagLabel } from "../match";
import { clear, countryFromRole, countryOf } from "../clearance";
import { judgePerson, WEAK_SOURCE } from "../contacts";
import { readAll } from "../web";
import { rejectionNotes } from "../desk";
import { slugify, token } from "../slug";
import { draft, findBuyer, findInbox, talentDeals } from "../desks/common";
import { planOf, type Lane, type PitchPlan } from "./plans";
import { affinities, audienceInsights, mergeSides, profile, resolve, sideOf, top, type Ent, type Insights } from "./qx";
import { metroOf } from "../geo";

const JOIN_MIN = 15;          // a run still going after this long is treated as stuck
const REUSE_MIN = 3;          // a visit right after a run finished shows that run instead of starting another
const DAILY_RUNS = 120;       // all personas together; each run costs about $0.30 of model calls
const POOL = 12;              // candidates scored per lane (ours vs Qloo's)
const BUYER_MS = 100_000, INBOX_MS = 60_000;

export const COL = { spotted: 0, checked: 1, person: 2, drafted: 3, clearance: 4, approval: 5 } as const;

const within = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>(r => setTimeout(() => r(fallback), ms))]);

// A talent's signed deals come from a web search that can take minutes the first time (a desk someone just set up for
// Becky G sat two minutes on it, then lost its brand lane, 23 Oct). One lookup per talent, started when the run starts,
// and nothing waits on it for long: the lane picks without it, and each card's deal check waits a little more.
type Deals = Awaited<ReturnType<typeof talentDeals>>;
const dealsLookups = new Map<string, Promise<Deals>>();
function dealsOf(talent: string) {
  let d = dealsLookups.get(talent);
  if (!d) {
    d = talentDeals(talent).catch(() => [] as Deals).finally(() => dealsLookups.delete(talent));
    dealsLookups.set(talent, d);
  }
  return d;
}
const PICK_DEALS_MS = 20_000, CARD_DEALS_MS = 60_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const host = (u: string | null | undefined) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return u ?? ""; } };
const f2 = (x: number | null | undefined) => x?.toFixed(2) ?? "n/a";

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

// Qloo calls made so far, per run in this process, so the board's count moves while the run goes.
const calls0 = new Map<string, number>();

async function step(runId: string, p: Persona, card: Card | null, col: number | null, agent: Agent, kind: string, summary: string, extra: Record<string, unknown> = {}, cost?: number) {
  await logAction({ agent, kind, summary, refTable: card ? "run_cards" : "runs", refId: card?.id ?? runId, llmCostUsd: cost,
    detail: { run: runId, persona: p.id, desk: card?.desk ?? null, col, ...extra } });
  const c0 = calls0.get(runId);
  if (c0 != null) await sql()`update runs set qloo_calls = ${qlooCallsMade() - c0} where id = ${runId}`;
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
  const p = run && await loadPersona(run.persona), plan = run && planOf(run.persona);
  if (!p || !plan) return;
  calls0.set(runId, qlooCallsMade());
  const calls = () => qlooCallsMade() - (calls0.get(runId) ?? 0);
  let cost = 0;
  try {
    cost = plan.kind === "review" ? await review(runId, p, plan.n) : await pitch(runId, p, plan);
    await sql()`update runs set status = 'done', finished_at = now(), qloo_calls = ${calls()}, cost_usd = ${cost} where id = ${runId}`;
    const [{ n, held }] = (await sql()`select count(*) filter (where c.status = 'done')::int n,
        count(*) filter (where r.clearance->>'status' = 'hold')::int held
      from run_cards c left join permission_requests r on r.id = c.request_id where c.run_id = ${runId}`) as { n: number; held: number }[];
    await step(runId, p, null, null, plan.kind === "review" ? "clearance" : "sequencer", "run.finished", plan.kind === "review"
      ? `Review finished: ${n} ${n === 1 ? "card" : "cards"} checked again, ${held} held. The report is ready.`
      : `Run finished: ${n} ${n === 1 ? "card is" : "cards are"} waiting for your approval. The report is ready.`);
  } catch (e) {
    await sql()`update runs set status = 'failed', finished_at = now(), error = ${(e as Error).message.slice(0, 300)}, qloo_calls = ${calls()}, cost_usd = ${cost} where id = ${runId}`;
    await step(runId, p, null, null, "scout", "run.failed", `The run stopped early: ${(e as Error).message.slice(0, 140)}.`);
  } finally {
    calls0.delete(runId);
  }
}

const resolveAll = async (sigs: Lane["signal"]) => (await Promise.all(sigs.map(s => resolve(s.name, s.type)))).filter((e): e is Ent => !!e);
/** How a lane's audience is named in steps and drafts. */
const crowd = (lane: Lane, sig: Ent[]) => lane.audience ?? `${sig.map(s => s.name).join(" and ")}'s fans`;
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

async function pitch(runId: string, p: Persona, plan: PitchPlan) {
  const lanes = typeof plan.lanes === "function" ? await plan.lanes() : plan.lanes;
  if (!lanes.length) throw new Error("this desk has nothing to work on today");
  const first = lanes[0];
  const subject = await resolveAll(first.signal);
  if (!subject.length) throw new Error(`Qloo has no record for ${first.signal[0].name}`);
  await step(runId, p, null, null, "scout", "run.started", `Live run for ${p.title}. Reading ${crowd(first, subject)} in Qloo now.`);
  const talents = [...new Set(lanes.filter(l => l.talent && (l.target ?? "brand") === "brand").map(l => l.talent!))];
  for (const t of talents) {
    dealsOf(t);
    await step(runId, p, null, null, "checker", "run.deals", `Looking up the brand deals ${t} already has, so the desk doesn't pitch one of them.`);
  }

  // What Qloo says about the audience (its network, shows, podcasts, interests) is read once the first lane is measured,
  // alongside the cards, so the first card doesn't queue behind it for Qloo calls.
  const readAudience = async () => {
    const cells = (await profile(subject[0].id)).cells;
    const city = first.location ?? cells.map(c => metroOf(c)).find(Boolean) ?? plan.city;
    const ins: Insights = await audienceInsights(subject.map(s => s.id), city);
    const self = new Set(subject.map(s => s.name.toLowerCase()));
    ins.people = ins.people.filter(n => !self.has(n.toLowerCase()));
    await sql()`update runs set insights = ${JSON.stringify(ins)} where id = ${runId}`;
    const groups = ins.audiences.slice(0, 3).map(a => a.name);
    await step(runId, p, null, null, "numbers", "run.audience",
      `Qloo, live: ${crowd(first, subject)} also follow ${listOf(ins.people.slice(0, 3)) || "no one Qloo lists"}` +
      `${groups.length ? `, and over-index on ${listOf(groups)}` : ""}${ins.local.length ? `. In ${city} they lean toward ${listOf(ins.local.slice(0, 3).map(l => l.name))}` : ""}.`.replace(/\.\.$/, "."));
  };
  let insights: Promise<void> = Promise.resolve();

  // Names are compared with spaces collapsed: older cards kept Qloo's "JAJA  Tequila".
  const taken = new Set(((await sql()`select target->>'org' org from permission_requests where persona = ${p.id}`) as { org: string }[]).map(r => r.org.replace(/\s+/g, " ").trim().toLowerCase()));
  for (const b of p.brands ?? []) taken.add(b.toLowerCase());
  // Cards start moving as soon as the first lane is measured; later lanes are measured while those cards travel.
  // Two cards in flight at a time: fast enough to finish in a few minutes, slow enough to stay inside the model quotas.
  const queue: (() => Promise<number>)[] = [];
  let producing = true, cost = 0;
  const workers = [0, 1].map(async () => {
    while (producing || queue.length) { const job = queue.shift(); if (job) cost += await job(); else await sleep(300); }
  });
  try {
    for (const [i, lane] of lanes.entries()) {
      try { await measureLane(runId, p, lane, taken, queue); }
      catch (e) { await step(runId, p, null, null, "numbers", "run.lane_failed", `Skipped ${lane.speaker}'s lane: ${(e as Error).message.slice(0, 120)}.`); }
      if (i === 0) insights = readAudience().catch(() => {});
    }
  } finally { producing = false; }
  await Promise.all(workers);
  await insights;
  return cost;
}

// Government programs and public bodies sit in Qloo's brand lists (TSA PreCheck for the Golden Globes, 23 Oct) but buy no
// sponsorship.
const NOT_A_BUYER = /\b(tsa|precheck|global entry|dmv|usps|irs|social security|medicare|medicaid|fema|national park service|department of|u\.?s\.? (army|navy|air force|marines))\b/i;

const NOUNS: Partial<Record<string, [string, string]>> = { brand: ["brand", "brands"], artist: ["artist", "artists"], person: ["person", "people"], place: ["room", "rooms"] };
const many = (n: number, kind: string) => `${n} ${(NOUNS[kind] ?? ["candidate", "candidates"])[n === 1 ? 0 : 1]}`;

type Scored = { c: Ent & { affinity: number | null }; back: number | null; twoWay: number | null; m: Awaited<ReturnType<typeof syzygyMatch>> };

async function measureLane(runId: string, p: Persona, lane: Lane, taken: Set<string>, queue: (() => Promise<number>)[]) {
  const sig = await resolveAll(lane.signal);
  if (!sig.length) return;
  const who = crowd(lane, sig);
  const kind = lane.target ?? "brand";
  // Brands the talent already has a deal with are skipped up front, so the lane picks the next one instead of dropping a card.
  const known = lane.talent && kind === "brand" ? (await within(dealsOf(lane.talent), PICK_DEALS_MS, [] as Deals)).map(d => d.brand) : [];
  const skip = new Set([...(lane.exclude ?? []), ...sig.map(s => s.name), ...known].map(x => x.toLowerCase()));
  const [lo, hi] = lane.popularity ?? [0, 1];
  const fresh = (xs: Awaited<ReturnType<typeof top>>) => xs
    .map(c => ({ ...c, name: c.name.replace(/\s+/g, " ").trim() }))   // Qloo has "JAJA  Tequila"
    .filter(c => c.affinity != null && !taken.has(c.name.toLowerCase()) && !skip.has(c.name.toLowerCase())
      && (kind !== "brand" || !NOT_A_BUYER.test(c.name)) && (c.popularity == null || (c.popularity >= lo && c.popularity <= hi)))
    .slice(0, POOL);
  // A popularity band keeps only a slice of the list, so those lanes read deeper (Qloo allows 50 at most).
  const take = lane.popularity ? 50 : 40;
  let pool = fresh(await top(sig.map(s => s.id), kind, take, lane.tags, lane.location, lane.within));
  // A category read in one city can come back empty; the city's whole list is the fallback (rooms keep their category).
  if (!pool.length && lane.tags?.length && kind === "brand") pool = fresh(await top(sig.map(s => s.id), kind, take, [], lane.location, lane.within));
  if (!pool.length) return;
  await step(runId, p, null, null, "numbers", "run.measuring", `Qloo listed ${many(pool.length, kind)} for ${who}${lane.within ? ` in ${lane.within}` : ""}. Measuring each one back the other way now.`);
  const me = lane.side ?? mergeSides(who, await Promise.all(sig.map(sideOf)));
  // Qloo measures each pair both ways: how much these fans like the brand (free with the list), and how much the brand's
  // own audience likes them back (one call per brand, every member of the signal at once). The weaker is the two-way score.
  const scored: Scored[] = await Promise.all(pool.map(async c => {
    const backs = await affinities([c.id], sig.map(s => s.id), sig[0].type).catch(() => new Map<string, number | null>());
    const vals = [...backs.values()].filter((v): v is number => v != null);
    const back = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { c, back, twoWay: back != null ? Math.min(c.affinity!, back) : null, m: await syzygyMatch(me, await sideOf(c)) };
  }));
  // How close our estimate is to Qloo's own measurement, for every brand this lane looked at.
  const aId = sig.map(s => s.id).join("+");
  for (const { c, m, back } of scored) {
    await sql()`insert into estimate_checks (source, run_id, a_id, b_id, a_name, b_name, ours, qloo_toward, qloo_back)
      values ('run', ${runId}, ${aId}, ${c.id}, ${lane.audience ?? sig.map(s => s.name).join(" + ")}, ${c.name}, ${m.score}, ${c.affinity}, ${back})
      on conflict (source, a_id, b_id) do update set run_id = excluded.run_id, a_name = excluded.a_name, ours = excluded.ours,
        qloo_toward = excluded.qloo_toward, qloo_back = excluded.qloo_back, created_at = now()`;
  }
  const both = scored.filter(s => s.twoWay != null);
  const rho = spearman(both.map(s => s.m.score), both.map(s => s.twoWay!));
  await step(runId, p, null, null, "numbers", "run.compared",
    `Measured ${many(both.length, kind)} both ways for ${who}. How close our rough estimate came to Qloo's ranking: ${rho == null ? "too few to compare" : `${rho} rank correlation (1 is a perfect match)`}.`,
    { lane: `${lane.desk}:${lane.speaker}`, rho, n: both.length });
  // Qloo's two-way measurement picks; our rough estimate only breaks ties and rides along on the card.
  const ranked = [...scored].sort((a, b) => (b.twoWay ?? -1) - (a.twoWay ?? -1) || b.m.score - a.m.score);
  const picks = ranked.slice(0, lane.n);
  for (const { c } of picks) taken.add(c.name.toLowerCase());
  for (const s of picks) queue.push(() => carry(runId, p, lane, sig, s, ranked.indexOf(s), ranked.length));
}

/** One card, Spotted to Your approval. Returns what its model calls cost. */
async function carry(runId: string, p: Persona, lane: Lane, sig: Ent[], s: Scored, rank: number, of: number) {
  const { c } = s;
  const title = lane.title(c.name);
  const [row] = (await sql()`insert into run_cards (run_id, persona, desk, title, org, entity_id) values (${runId}, ${p.id}, ${lane.desk}, ${title}, ${c.name}, ${c.id}) returning id`) as { id: string }[];
  const card = { id: row.id, desk: lane.desk };
  // A card that fails (a model call timing out, a page that won't load) is dropped on its own; the run carries on.
  try { return await carryCard(runId, p, lane, sig, s, rank, of, card, title); }
  catch (e) {
    await sql()`update run_cards set status = 'dropped', detail = ${JSON.stringify({ why: (e as Error).message.slice(0, 200) })} where id = ${card.id}`;
    await step(runId, p, card, null, "sequencer", "card.dropped", `Dropped ${c.name}: ${/timeout|abort/i.test((e as Error).message) ? "an agent ran out of time on it" : "an agent hit an error on it"}. The next run tries again.`);
    return 0;
  }
}

// Place keywords and tags nearly every show carries ("Actor", "Love") say nothing about why two audiences fit.
const PLACE_TAG = /\b(city|california|new york|los angeles|texas|florida|chicago|atlanta|miami|london|paris|tokyo|puerto rico|new jersey|georgia|ohio|spain|madrid|england|italy|france|japan|korea|brazil|colombia)\b|^(actor|actress|love|secret|family relationships|friendship|21st century|female protagonist|male protagonist|based on a true story|celebrity)$/i;

async function carryCard(runId: string, p: Persona, lane: Lane, sig: Ent[], s: Scored, rank: number, of: number, card: Card, title: string) {
  const { c, m, back } = s;
  const who = crowd(lane, sig);
  await step(runId, p, card, COL.spotted, lane.agent, "card.spotted",
    `Spotted in Qloo, live: ${who} lean toward ${c.name} at ${f2(c.affinity)} (out of 1). Number ${rank + 1} of ${of} once Qloo measured both ways.`);

  // Checked: Qloo's two-way score with our rough estimate beside it, and the talent's known deals (brand pitches only).
  const isBrand = (lane.target ?? "brand") === "brand";
  const deals = lane.talent && isBrand ? await within(dealsOf(lane.talent), CARD_DEALS_MS, [] as Deals) : [];
  // Everyone named in the message as talent, so Clearance checks none of them reads as endorsing anything.
  const named = [...(lane.talent ? [lane.talent] : []), ...(lane.target === "artist" || lane.target === "person" ? [c.name] : [])];
  const clash = deals.find(d => d.brand.toLowerCase() === c.name.toLowerCase());
  if (clash) {
    await sql()`update run_cards set status = 'dropped', detail = ${JSON.stringify({ why: "existing deal", deal: clash })} where id = ${card.id}`;
    await step(runId, p, card, COL.checked, "checker", "card.dropped", `Deal check: ${lane.talent} already works with ${c.name} (${clash.year ?? "recent"}). Not pitching.`);
    return 0;
  }
  // Place keywords ("Los angeles california") are where a show is set, not a taste; the cities line covers geography.
  const shared = m.sharedTags.filter(t => !PLACE_TAG.test(t)).slice(0, 3).map(tagLabel);
  await step(runId, p, card, COL.checked, "numbers", "card.checked",
    `Qloo score ${f2(s.twoWay)}/1: ${f2(c.affinity)} toward ${c.name}, ${f2(back)} back. Our rough estimate: ${m.score}/100.` +
    `${shared.length ? ` Shared tastes: ${shared.join(", ")}.` : ""}${deals.length ? " No clash with known deals." : ""}`,
    { ours: m.score, toward: c.affinity, back });

  // Person found: who decides there, confirmed on pages we read ourselves; their published inbox as the route.
  const site = c.site;
  const [buyer, inbox] = await Promise.all([
    within(findBuyer(c.name, site, lane.purpose, "US", { hunter: false, sweep: false }), BUYER_MS, null),
    within(findInbox(c.name, site, lane.purpose), INBOX_MS, { email: null, url: null, postal: null, status: "not_found", cost: 0 }),
  ]);
  await step(runId, p, card, COL.person, "contact_finder", "card.person",
    buyer ? `Found who decides: ${buyer.name}, ${buyer.role}, confirmed on ${host(buyer.page)}.${inbox.email ? " Their published inbox is the route." : " It goes by post."}`
      : `No named person confirmed in time. It goes to ${inbox.email ? `${c.name}'s published inbox` : `${c.name}'s office by post`}.`,
    { person: buyer?.name ?? null, page: buyer?.page ?? null });

  // Drafted. Qloo's measurement is the number in the pitch; our rough estimate stays on the board and out of the message.
  const facts = [
    ...(lane.facts ?? []),
    `Qloo's taste data, read today: ${who} lean toward ${c.name} at ${f2(c.affinity)}${back != null ? `, and ${c.name}'s audience leans back at ${back.toFixed(2)}` : ""} (0 to 1).`,
    ...(shared.length ? [`Shared audience tastes: ${shared.join(", ")}.`] : []),
    ...(m.sharedCities.length ? [`Both audiences concentrate in ${listOf(m.sharedCities.slice(0, 3))}.`] : []),
  ];
  const viaInbox = !!buyer && !!inbox.email;
  const d = await draft({ kind: lane.ask(c.name), sender: p.title, facts, recipient: c.name,
    // Reasons people gave when they rejected this desk's earlier drafts: the writer takes them as standing notes.
    notes_from_rejections: await rejectionNotes(p.id, lane.desk),
    ...(buyer ?{ recipient_person: { name: buyer.name, role: buyer.role }, ...(viaInbox ? { delivered_via: `the organisation's published inbox, marked for ${buyer.name}'s attention` } : {}) } : {}) });
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
    roleStatus: buyer ? "confirmed" : null, country, talent: named, targetBrand: isBrand ? c.name : null, talentDeals: deals, usesQloo: true });
  const held = clearance.checks.filter(x => !x.pass);
  await step(runId, p, card, COL.clearance, "clearance", held.length ? "card.held" : "card.cleared",
    held.length ? `Held. ${held.map(h => h.note).join(" ")}` : `Cleared on all ${clearance.checks.length} rules.`);

  // Your approval: filed as a permission request, like every desk card.
  const target = { org: c.name, site, person: buyer?.name ?? null, role: buyer?.role ?? null, roleStatus: buyer ? "confirmed" : null, personSource: buyer?.page ?? null,
    address: inbox.email, source: inbox.url, postal: inbox.postal, channel, country, talent: named, brand: isBrand ? c.name : null, purpose: lane.purpose };
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

type Filed = { id: string; persona: string; title: string; target: Record<string, any>; preview: { subject: string; body: string }; evidence: { match?: { qloo?: unknown } | null; facts: string[] }; clearance: { status: string } };

/** Studio clearance's run: the newest cards the live desks filed that nobody has decided, each checked again from scratch. */
async function review(runId: string, p: Persona, n: number) {
  await step(runId, p, null, null, "clearance", "run.started", `Review run for ${p.title}. Clearance is pulling the newest cards the other desks filed and checking each one again, live.`);
  const rows = (await sql()`select r.id, r.persona, r.title, r.target, r.preview, r.evidence, r.clearance from permission_requests r
    where r.run_id is not null and r.persona <> ${p.id} and r.action <> 'crm_push'
      and not exists (select 1 from request_decisions d where d.request_id = r.id)
    order by coalesce(r.clearance->>'reviewedAt', '1970-01-01') asc, r.created_at desc limit ${n}`) as Filed[];
  if (!rows.length) throw new Error("no filed cards are waiting for a decision");
  const queue = [...rows];
  await Promise.all([0, 1].map(async () => {
    while (queue.length) {
      const r = queue.shift()!;
      const [row] = (await sql()`insert into run_cards (run_id, persona, desk, title, org) values (${runId}, ${p.id}, 'clearance', ${r.title}, ${r.target.org}) returning id`) as { id: string }[];
      const card = { id: row.id, desk: "clearance" };
      try { await reviewCard(runId, p, card, r); }
      catch (e) {
        await sql()`update run_cards set status = 'dropped', detail = ${JSON.stringify({ why: (e as Error).message.slice(0, 200) })} where id = ${card.id}`;
        await step(runId, p, card, null, "clearance", "card.dropped", `Couldn't finish re-checking ${r.target.org}: ${(e as Error).message.slice(0, 100)}. It keeps its last record.`);
      }
    }
  }));
  return 0;   // a review's only model call is the exclusivity check, a fraction of a cent, not priced per run
}

async function reviewCard(runId: string, p: Persona, card: Card, r: Filed) {
  const t = r.target, owner = await loadPersona(r.persona);
  const desk = owner?.title ?? r.persona;
  await step(runId, p, card, 0, "clearance", "review.picked",
    `Picked up from ${desk}: ${t.channel === "email" ? "an email" : "a letter"} to ${t.person ? `${t.person} at ` : ""}${t.org}, ${r.clearance.status === "pass" ? "cleared" : "held"} when it was filed.`);

  // Deals: the talent named in it, against what they've signed (read fresh when the record is over a fortnight old).
  const talent: string[] = t.talent ?? [];
  const deals = talent.length ? await within(dealsOf(talent[0]), CARD_DEALS_MS, [] as Deals) : [];
  const recent = deals.filter(d => (d.year ?? 0) >= new Date().getFullYear() - 1).slice(0, 3);
  await step(runId, p, card, 1, "checker", "review.deals", talent.length
    ? `${talent[0]} has ${deals.length} brand deals on record${recent.length ? `, the latest with ${listOf(recent.map(d => `${d.brand} (${d.category})`))}` : ""}. Checking ${t.brand ?? t.org} against them.`
    : `No talent is named in this message, so there are no exclusive deals to check.`);

  // Person: the page that confirmed them, read again. A gossip site or lead database never counts.
  let roleStatus: string | null = t.roleStatus ?? null, personNote: string;
  if (t.person && t.personSource) {
    const h = host(t.personSource);
    if (WEAK_SOURCE.test(h)) { roleStatus = "weak_source"; personNote = `${t.person} was confirmed on ${h}, a gossip site or lead database. That doesn't count as a source.`; }
    else {
      const pages = await readAll([t.personSource], 1);
      const v = judgePerson(pages, t.person, t.role ?? "", t.org, host(t.site) || null);
      if (v.status === "departed") { roleStatus = "departed"; personNote = `${t.person} has left: ${h} now says "${v.gone?.phrase ?? "former"}".`; }
      else if (v.status === "confirmed" || v.status === "stale") personNote = `${t.person} is still named${t.role ? ` as ${t.role}` : ""} on ${h}${v.date ? ` (dated ${v.date.slice(0, 10)})` : ""}.`;
      else personNote = pages.length ? `${h} no longer names ${t.person} in that role. Keeping the earlier check; worth a look.` : `${h} didn't load just now. Keeping the earlier check.`;
    }
  } else personNote = `No named person: it goes to ${t.address ? "the published inbox" : "the office by post"}, so there's no one to re-check.`;
  await step(runId, p, card, 2, "verifier", "review.person", personNote);

  // Wording, read line by line: disclosure up front, house style, and how the audience is described.
  const msg = r.preview, all = `${msg.subject}\n${msg.body}`;
  const words = msg.body.split(/\s+/).length;
  const slips = [
    ...(/\bai\b|artificial intelligence/i.test(msg.body.slice(0, 260)) ? [] : ["no AI disclosure in the opening"]),
    ...(/—/.test(all) ? ["an em dash"] : []),
    ...(/%|\bper ?cent\b/i.test(all) ? ["a percentage (Qloo numbers run 0 to 1)"] : []),
    ...(words > 170 ? [`${words} words, over the limit`] : []),
  ];
  await step(runId, p, card, 3, "clearance", "review.wording",
    slips.length ? `Wording: ${words} words. Found ${listOf(slips)}.` : `Wording: ${words} words, AI disclosure in the first lines, no em dashes, no percentages.`);

  // The ruling: every rule again, on what's true now.
  const c = await clear({ channel: t.channel, subject: msg.subject, body: msg.body, address: t.address ?? null, addressSource: t.address ? "published" : null,
    roleStatus, country: t.country, talent, targetBrand: t.brand ?? null, talentDeals: deals,
    usesQloo: !!r.evidence.match?.qloo || r.evidence.facts.some(f => /qloo's taste data/i.test(f)) });
  const held = c.checks.filter(x => !x.pass);
  await sql()`update permission_requests set clearance = ${JSON.stringify({ ...c, reviewedAt: new Date().toISOString() })},
    target = ${JSON.stringify({ ...t, roleStatus })} where id = ${r.id}`;
  const was = r.clearance.status === "pass" ? "cleared" : "held";
  await step(runId, p, card, 4, "clearance", held.length ? "review.held" : "review.cleared",
    held.length ? `Held${was === "cleared" ? " (it was cleared before)" : ""}. ${held.map(h => h.note).join(" ")}` : `Cleared on all ${c.checks.length} rules${was === "held" ? " (it was held before)" : ""}.`);
  await sql()`update run_cards set status = 'done', request_id = ${r.id} where id = ${card.id}`;
  await step(runId, p, card, 5, "clearance", "review.filed",
    held.length ? `Back on the ${desk} desk, held until the note is fixed.` : `Back on the ${desk} desk, waiting for their approval.`, { request: r.id });
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
