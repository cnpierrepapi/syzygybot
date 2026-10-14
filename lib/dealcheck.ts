// Deal check: before a thesis goes anywhere, make sure the two sides aren't already partners. A pitch that
// says "your audiences line up" to two brands with a collab on shelves right now is a pitch that gets binned.
// It looks in every place a partnership leaves a trace:
//   - Wikipedia, both sides' articles (collabs, sponsorships, ambassador deals, usually with the year)
//   - Google, through Gemini's search grounding (newsrooms, press releases, drop pages, retailer listings)
//   - Bing News, open and limited to the trade press on our source list for both sides' industries
//   - the WordPress search feeds of those trade sources, which reach back years, and of both official sites
// Every page has to name both sides near each other, then the model judges what kind of link it is and
// quotes the line. The quote has to be on the page. Ongoing, announced, or dated this year or last = active:
// the thesis stops. Older = past: the pitch can go, but the Writer says they've worked together before.

import { sql } from "./db";
import { logAction } from "./actions";
import { ask, askWeb, parseJson } from "./llm";
import { readAll, type Page } from "./web";
import { stopSequence } from "./sequencer";
import { SOURCES, groupsFor } from "./sources";
import { readable, searchName } from "./sweep";
import status from "../data/sources-status.json";

const UA = "Mozilla/5.0 (compatible; SyzygyBot/0.1; +https://syzygybot.vercel.app)";
const DEAL_TERMS = `(collab OR collaboration OR partnership OR partners OR "teams up" OR sponsor OR sponsorship OR ambassador OR capsule OR "limited edition" OR campaign OR "co-branded")`;
const SITES_PER_QUERY = 8;
const MAX_TRADE_QUERIES = 3;
const MAX_FEEDS = 12;
const MAX_PAGES = 14;
const RECHECK_DAYS = 14;

export type DealStatus = "clear" | "past" | "active";
export type Finding = { url: string; quote: string; kind: string; year: number | null; ongoing: boolean; source: string };
export type DealCheck = {
  status: DealStatus; checked_at: string; findings: Finding[];
  searched: Record<string, number>; pages_read: number; co_mentions: number;
};

type Side = { qloo_id: string; name: string; type: string; official_site: string | null; wikidata: string | null; tags: string[]; hq: string | null };
type Hit = { url: string; title: string; source: string };

// ---- matching ----

// fold keeps the length (one character in, one out), so positions in folded text are positions in the original.
const fold = (s: string) => s.toLowerCase().replace(/[‐-―\-_/.'’]/g, " ");
const norm = (s: string) => fold(s).replace(/\s+/g, " ").trim();
/** Every way a side gets written: "Ray-Ban" and "Ray Ban", "Nike, Inc." as "Nike", plus aliases ("BAPE"). */
const forms = (names: string[]) => [...new Set(names.flatMap(n => [norm(n), norm(searchName(n))]))].filter(f => f.length >= 3);
export const mentions = (text: string, names: string[]) => { const t = ` ${norm(text)} `; return forms(names).some(f => t.includes(` ${f} `)); };

/** Stretches of a page where both sides are named within a few sentences of each other. */
export function coMentions(text: string, a: string[], b: string[], span = 400, max = 4) {
  const src = text.replace(/\s+/g, " "), low = fold(src);
  const at = (names: string[]) => forms(names).flatMap(f => [...low.matchAll(new RegExp(`(?<![a-z0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "g"))].map(m => m.index!));
  const pa = at(a), pb = at(b), out: string[] = [];
  let last = -Infinity;
  for (const i of pa.sort((x, y) => x - y)) {
    if (i - last < span || out.length >= max) continue;
    if (!pb.some(j => Math.abs(j - i) <= span)) continue;
    out.push(src.slice(Math.max(0, i - span), i + span).trim());
    last = i;
  }
  return out;
}

/** Active, past or clear, from verified findings. Code decides, not the model. */
export function decide(findings: Finding[], now = new Date()): DealStatus {
  if (!findings.length) return "clear";
  // Dated this year or last: they're working together. "Ongoing" only counts on an undated finding; a 2014 page
  // that says "in partnership with" was present tense in 2014.
  const recent = (f: Finding) => f.year != null && f.year >= now.getUTCFullYear() - 1;
  return findings.some(f => recent(f) || (f.ongoing && f.year == null)) ? "active" : "past";
}

// ---- sources ----

/** Wikidata's English label and aliases (A Bathing Ape is "BAPE" in most headlines) and the Wikipedia title. */
async function identity(s: Side): Promise<{ names: string[]; title: string }> {
  const names = [s.name];
  if (!s.wikidata) return { names, title: s.name };
  try {
    const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${s.wikidata}&props=labels|aliases|sitelinks&languages=en&sitefilter=enwiki&format=json`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
    const e = ((await r.json()) as { entities?: Record<string, { labels?: { en?: { value: string } }; aliases?: { en?: { value: string }[] }; sitelinks?: { enwiki?: { title: string } } }> }).entities?.[s.wikidata];
    if (e?.labels?.en) names.push(e.labels.en.value);
    // Short or all-lowercase aliases are usually ticker symbols, handles or common words; skip them.
    for (const a of e?.aliases?.en ?? []) if (a.value.length >= 4 && /[A-Z]/.test(a.value) && names.length < 6) names.push(a.value);
    return { names: [...new Set(names)], title: e?.sitelinks?.enwiki?.title ?? s.name };
  } catch { return { names, title: s.name }; }
}

async function wikipedia(title: string): Promise<Page | null> {
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
    const page = Object.values(((await r.json()) as { query?: { pages?: Record<string, { title?: string; extract?: string; missing?: string }> } }).query?.pages ?? {})[0];
    if (!page?.extract || page.missing !== undefined) return null;
    return { url: `https://en.wikipedia.org/wiki/${encodeURIComponent((page.title ?? title).replace(/ /g, "_"))}`, status: 200, text: page.extract, date: null, emails: [] };
  } catch { return null; }
}

async function bingNews(q: string): Promise<Hit[]> {
  try {
    const r = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&count=30&mkt=en-US&setlang=en-US&cc=US`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    return [...(await r.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const link = /<link>([^<]*)<\/link>/.exec(m[1])?.[1].replace(/&amp;/g, "&") ?? "";
      const url = decodeURIComponent(/[?&]url=([^&]+)/.exec(link)?.[1] ?? link);
      const title = (/<title>([^<]*)<\/title>/.exec(m[1])?.[1] ?? "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
      return { url, title, source: "Bing News" };
    }).filter(h => h.url.startsWith("http"));
  } catch { return []; }
}

/** A WordPress site's own search: every article naming both sides, however old. */
async function wpSearch(base: string, source: string, q: string): Promise<Hit[]> {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/?s=${encodeURIComponent(q)}&feed=rss2`, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok || !/xml|rss/i.test(r.headers.get("content-type") ?? "")) return [];
    const strip = (x?: string) => (x ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").trim();
    return [...(await r.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5)
      .map(m => ({ url: strip(/<link>([\s\S]*?)<\/link>/.exec(m[1])?.[1]), title: `${strip(/<title>([\s\S]*?)<\/title>/.exec(m[1])?.[1])} ${strip(/<description>([\s\S]*?)<\/description>/.exec(m[1])?.[1])}`, source }))
      .filter(h => h.url.startsWith("http"));
  } catch { return []; }
}

// No JSON-only rule here: with one, Gemini tends to answer from memory and never search. The pages it
// searched come back as grounding sources, and those are what get read.
const GOOGLE_SYSTEM = `You check whether two companies, brands, artists or shows have ever partnered: a collaboration
product, co-branded drop, sponsorship, brand ambassador or endorsement deal, campaign starring one for the other,
licensing deal, or co-hosted event. Always search the web first, including the newest news, then answer in a few
sentences with years. A celebrity merely wearing or using a product does not count.`;

// Second pass, only when Google's answer says they did partner but no page we read showed it.
const LINKS_SYSTEM = `Search the web and list the pages that report the partnership between the two names given,
newest first. Reply with JSON only: {"links":[{"url":"","year":0}]}`;
export const saysYes = (t: string) => /^\W*yes\b/i.test(t) || (/\b(have|has) (partnered|collaborated|teamed up)\b/i.test(t.slice(0, 300)) && !/\bnever\b/i.test(t.slice(0, 200)));

const results = (status as { results: Record<string, { search_feed?: string }> }).results;

// ---- the judge ----

const JUDGE_SYSTEM = `You read passages where two names appear together and decide whether they show a real
partnership between them: a collaboration product, co-branded drop, sponsorship, ambassador or endorsement deal,
a campaign one made for or with the other, a licensing deal, or a co-hosted event.
NOT a partnership: someone wearing, using or praising a product; both appearing in the same list, roundup or
event lineup; a rumour, fan wish or petition; a different entity that shares a name.
For each real partnership give: the passage id, a quote copied exactly from that passage (one sentence, must name
both sides or clearly refer to both), kind (collab, sponsorship, ambassador, campaign, licensing, event, other),
year it started or ran (null if the passage doesn't say), and ongoing (true only if the passage says it is running
now, upcoming or just announced). Reply with JSON only:
{"findings":[{"id":0,"quote":"","kind":"","year":null,"ongoing":false}]}`;

const squash = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

export async function checkPair(pairId: string) {
  const [p] = (await sql()`
    select p.id, p.band, row_to_json(a) a, row_to_json(b) b from pairs p
    join (select qloo_id, name, type, official_site, wikidata, raw->'properties'->>'headquartered' hq, coalesce((select jsonb_agg(t->>'name') from jsonb_array_elements(coalesce(raw->'tags','[]'::jsonb)) t), '[]'::jsonb) tags from entities) a on a.qloo_id = p.a_id
    join (select qloo_id, name, type, official_site, wikidata, raw->'properties'->>'headquartered' hq, coalesce((select jsonb_agg(t->>'name') from jsonb_array_elements(coalesce(raw->'tags','[]'::jsonb)) t), '[]'::jsonb) tags from entities) b on b.qloo_id = p.b_id
    where p.id = ${pairId}`) as { id: string; band: string; a: Side; b: Side }[];
  if (!p) throw new Error(`no pair ${pairId}`);
  const [idA, idB] = await Promise.all([identity(p.a), identity(p.b)]);
  const A = searchName(p.a.name), B = searchName(p.b.name);
  // Bing query terms: the name plus the aliases, e.g. ("A Bathing Ape" OR "BAPE").
  const q = (names: string[]) => { const f = [...new Set(names.map(searchName))].slice(0, 3); return f.length > 1 ? `(${f.map(n => `"${n}"`).join(" OR ")})` : `"${f[0]}"`; };
  const QA = q(idA.names), QB = q(idB.names);

  // Trade press for both sides' industries, the readable sources only.
  const groups = [...new Set([...groupsFor(p.a.type, p.a.tags ?? [], p.a.hq), ...groupsFor(p.b.type, p.b.tags ?? [], p.b.hq)])]
    .filter(g => !["wire", "registry", "business", "talent", "conference", "awards"].includes(g));
  const trade = SOURCES.filter(s => readable(s) && groups.includes(s.group) && !s.domain.includes("/"));
  const tradeQueries = [] as string[];
  for (let i = 0; i < trade.length && tradeQueries.length < MAX_TRADE_QUERIES; i += SITES_PER_QUERY)
    tradeQueries.push(`${QA} ${QB} (${trade.slice(i, i + SITES_PER_QUERY).map(s => `site:${s.domain}`).join(" OR ")})`);
  const feeds = trade.filter(s => results[s.domain]?.search_feed).slice(0, MAX_FEEDS);
  const official = [p.a.official_site, p.b.official_site].filter((x): x is string => !!x);

  const [wikiA, wikiB, google, news, tradeNews, feedHits, officialHits] = await Promise.all([
    wikipedia(idA.title), wikipedia(idB.title),
    askWeb(`Have ${idA.names.join(" / ")} (${p.a.type.replace("_", " ")}) and ${idB.names.join(" / ")} (${p.b.type.replace("_", " ")}) ever partnered or collaborated? Search for it.`, GOOGLE_SYSTEM, 800).catch(() => null),
    Promise.all([bingNews(`${QA} ${QB}`), bingNews(`${QA} ${QB} ${DEAL_TERMS}`), bingNews(`${A} ${B} collab`)]).then(x => x.flat()),
    Promise.all(tradeQueries.map(bingNews)).then(x => x.flat().map(h => ({ ...h, source: "trade press (Bing News)" }))),
    Promise.all(feeds.map(s => wpSearch(results[s.domain].search_feed!, s.name, `${A} ${B}`))).then(x => x.flat()),
    // Each official site searched for the other side's name.
    Promise.all([
      p.a.official_site ? wpSearch(p.a.official_site, `${p.a.name} official site`, B) : [],
      p.b.official_site ? wpSearch(p.b.official_site, `${p.b.name} official site`, A) : [],
    ]).then(x => x.flat()),
  ]);

  const googleHits: Hit[] = [...new Set((google?.sources ?? []).map(s => s.url))].map(url => ({ url, title: "", source: "Google" }));
  // Headlines that already name both sides go first; Google's picks are read regardless.
  const both = (h: Hit) => mentions(h.title, idA.names) && mentions(h.title, idB.names);
  const either = (h: Hit) => mentions(h.title, idA.names) || mentions(h.title, idB.names);
  const listed = [...news, ...tradeNews, ...feedHits, ...officialHits];
  const queue = [...listed.filter(both), ...googleHits, ...listed.filter(h => !both(h) && either(h))];
  const seen = new Set<string>(), toRead: Hit[] = [];
  for (const h of queue) if (!seen.has(h.url) && !h.url.includes("linkedin.com")) { seen.add(h.url); toRead.push(h); }
  const read = await readAll(toRead.slice(0, MAX_PAGES).map(h => h.url), MAX_PAGES);
  const sourceOf = (url: string) => toRead.find(h => h.url === url)?.source ?? (url.includes("wikipedia.org") ? "Wikipedia" : "Google");
  const pages = [wikiA, wikiB, ...read].filter((x): x is Page => !!x);

  const passages: { id: number; url: string; date: string | null; source: string; text: string }[] = [];
  const addPassages = (list: Page[], source?: string) => {
    for (const pg of list) for (const text of coMentions(pg.text, idA.names, idB.names)) {
      if (passages.length >= 28) break;
      passages.push({ id: passages.length, url: pg.url, date: pg.date, source: source ?? sourceOf(pg.url), text });
    }
  };
  addPassages(pages);
  let followUp = 0, extraCost = 0;
  if (google && saysYes(google.text) && !passages.some(x => x.source === "Google")) {
    const w = await askWeb(`${idA.names[0]} and ${idB.names[0]}: ${google.text.slice(0, 400)}`, LINKS_SYSTEM, 500).catch(() => null);
    const urls = [...new Set([...(parseJson<{ links?: { url: string }[] }>(w?.text ?? "")?.links ?? []).map(l => l.url), ...(w?.sources ?? []).map(s => s.url)])].filter(u => u && !seen.has(u));
    const more = await readAll(urls.slice(0, 6), 6);
    followUp = more.length; extraCost = w?.costUsd ?? 0;
    pages.push(...more); addPassages(more, "Google");
  }

  let findings: Finding[] = [], cost = (google?.costUsd ?? 0) + extraCost, model = "";
  if (passages.length) {
    const r = await ask("write", JUDGE_SYSTEM, JSON.stringify({ side_a: idA.names.join(" / "), side_b: idB.names.join(" / "), today: new Date().toISOString().slice(0, 10), passages: passages.map(({ url: _u, source: _s, ...x }) => x) }), 900);
    cost += r.costUsd ?? 0; model = r.model;
    const j = parseJson<{ findings?: { id: number; quote: string; kind: string; year: number | null; ongoing: boolean }[] }>(r.text) ?? {};
    for (const f of j.findings ?? []) {
      const ps = passages[f.id];
      // The quote has to be on the page, word for word, inside the passage that names both sides.
      if (!ps || !f.quote || f.quote.length < 15 || !squash(ps.text).includes(squash(f.quote))) continue;
      const year = Number.isFinite(Number(f.year)) && Number(f.year) > 1900 ? Number(f.year) : (ps.date ? new Date(ps.date).getUTCFullYear() : null);
      if (!findings.some(x => x.url === ps.url && x.quote === f.quote))
        findings.push({ url: ps.url, quote: f.quote.trim(), kind: f.kind || "other", year, ongoing: !!f.ongoing, source: ps.source });
    }
  }
  findings = findings.sort((x, y) => Number(y.ongoing) - Number(x.ongoing) || (y.year ?? 0) - (x.year ?? 0)).slice(0, 6);

  const result: DealCheck = {
    status: decide(findings), checked_at: new Date().toISOString(), findings,
    searched: {
      wikipedia: [wikiA, wikiB].filter(Boolean).length, google: googleHits.length, google_queries: google?.queries.length ?? 0, google_follow_up: followUp, bing_news: news.length,
      trade_sources: trade.length, trade_news: tradeNews.length, trade_feeds: feeds.length, official_sites: official.length,
    },
    pages_read: pages.length, co_mentions: passages.length,
  };
  await sql()`update pairs set deal_status = ${result.status}, deal_check = ${JSON.stringify(result)}, deal_checked_at = now() where id = ${p.id}`;

  const top = findings[0];
  const where = `${result.pages_read} pages across Wikipedia, Google, Bing News, ${trade.length} trade sources and the official sites`;
  let stopped = 0;
  if (result.status === "active") {
    // Anything already drafted on this thesis stops. The account's other theses can still carry it later.
    for (const c of (await sql()`select c.id from contacts c join accounts ac on ac.id = c.account_id where ac.pair_id = ${p.id}`) as { id: string }[])
      stopped += await stopSequence({ contactId: c.id }, `already partners: ${top.url}`);
  }
  await logAction({
    agent: "checker",
    kind: `deal.${result.status}`,
    summary: result.status === "clear"
      ? `${p.a.name} × ${p.b.name}: no existing partnership in ${where}. Clear to pitch.`
      : result.status === "active"
        ? `${p.a.name} × ${p.b.name} already work together (${top.kind}${top.year ? `, ${top.year}` : ""}${top.ongoing ? ", ongoing" : ""}). Not pitching${stopped ? `; ${stopped} drafted messages stopped` : ""}.`
        : `${p.a.name} × ${p.b.name} partnered before (${top.kind}, ${top.year ?? "date unknown"}), nothing recent. Clear to pitch; the Writer will say so.`,
    refTable: "pairs", refId: p.id,
    detail: { status: result.status, findings, searched: result.searched, pages_read: result.pages_read, model },
    llmCostUsd: cost || null,
  });
  return { pair: `${p.a.name} × ${p.b.name}`, status: result.status, findings: findings.length, pages: result.pages_read, stopped };
}

/** Unchecked theses first (PITCH before WATCH), then pitched theses whose last check is two weeks old. */
export async function runDealCheck(limit = 4, concurrency = 3) {
  const due = (await sql()`
    select p.id from pairs p
    where p.band in ('PITCH','WATCH') and (
      p.deal_status is null
      or (p.deal_status <> 'active' and p.deal_checked_at < now() - make_interval(days => ${RECHECK_DAYS})
          and exists (select 1 from accounts ac join contacts c on c.account_id = ac.id join touches t on t.contact_id = c.id
                      where ac.pair_id = p.id and t.status in ('draft','dry_run','queued'))))
    order by (p.deal_status is null) desc, (p.band = 'PITCH') desc, p.score desc
    limit ${limit}`) as { id: string }[];
  const out: { pair: string; status: DealStatus | "error"; findings: number; pages: number; stopped: number }[] = [];
  for (let i = 0; i < due.length; i += concurrency)
    out.push(...(await Promise.all(due.slice(i, i + concurrency).map(d => checkPair(d.id).catch(async e => {
      await logAction({ agent: "checker", kind: "deal.error", summary: "A deal check stopped on an error; it runs again next pass.", refTable: "pairs", refId: d.id, detail: { error: (e as Error).message.slice(0, 300) } });
      return { pair: d.id, status: "error" as const, findings: 0, pages: 0, stopped: 0 };
    })))));
  return out;
}
