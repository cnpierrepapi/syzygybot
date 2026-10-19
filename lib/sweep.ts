// Source sweep: the Contact finder's deterministic pass over the curated source list (lib/sources.ts).
// It asks Bing News for recent articles about the company's marketing and partnership people, restricted
// to the sources relevant to that company, keeps only articles from sources we can read (robots allow
// us, the page answers our honest user agent), reads them, and pulls out named people with titles and
// published press inboxes. For US public companies it also searches SEC 8-K filings, where officer
// appointments must be disclosed. The Verifier then judges every name against the page it came from.

import status from "../data/sources-status.json";
import { SOURCES, groupsFor, type Source } from "./sources";
import { readAll, type Page } from "./web";
import { ask, parseJson } from "./llm";

const UA = "Mozilla/5.0 (compatible; SyzygyBot/0.1; +https://syzygybot.vercel.app)";
const ROLE_TERMS = `(CMO OR "chief marketing officer" OR "chief brand officer" OR "head of partnerships" OR "brand partnerships" OR "head of marketing" OR "VP marketing" OR "vice president of marketing" OR sponsorship OR appoints OR names OR hires OR promotes)`;
const SITES_PER_QUERY = 8;
const MAX_QUERIES = 6;
const MAX_PAGES = 16;
const MAX_FEEDS = 16;
const MAX_AGE_MONTHS = 24;

type Status = { status: number; robots_block?: boolean; final?: string; search_feed?: string };
const results = (status as { results: Record<string, Status> }).results;
export const readable = (s: Source) => { const r = results[s.domain]; return !!r && r.status >= 200 && r.status < 400 && !r.robots_block; };
const READABLE = SOURCES.filter(readable);
/** Readable sources in these groups that publish a search feed (WordPress ?s=...&feed=rss2), for keyword watching. */
export const feedSources = (groups: string[]) =>
  READABLE.filter(s => groups.includes(s.group) && results[s.domain]?.search_feed).map(s => ({ ...s, feed: results[s.domain].search_feed! }));
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
/** The source an article URL belongs to, if it is on the list and readable. */
export function sourceOf(url: string) {
  const h = hostOf(url);
  return READABLE.find(s => { const d = s.domain.split("/")[0]; return h === d || h.endsWith(`.${d}`); }) ?? null;
}

export type Hit = { url: string; title: string; date: string | null; source: string; via: "bing_news" | "search_feed" | "sec_8k"; score?: number };

/** Bing News RSS: direct article URLs with dates. */
async function bingNews(q: string): Promise<Hit[]> {
  try {
    const r = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&count=30`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const item = m[1];
      const link = /<link>([^<]*)<\/link>/.exec(item)?.[1].replace(/&amp;/g, "&") ?? "";
      const url = decodeURIComponent(/[?&]url=([^&]+)/.exec(link)?.[1] ?? link);
      const title = (/<title>([^<]*)<\/title>/.exec(item)?.[1] ?? "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
      const pub = /<pubDate>([^<]*)<\/pubDate>/.exec(item)?.[1];
      return { url, title, date: pub ? new Date(pub).toISOString() : null, source: sourceOf(url)?.name ?? hostOf(url), via: "bing_news" as const };
    }).filter(h => h.url.startsWith("http"));
  } catch { return []; }
}

const ROLE_WORDS = /\b(cmo|chief marketing|chief brand|marketing|partnerships?|sponsorships?|appoints?|names|hires?|promotes?|joins|executive|vp|vice president|head of)\b/i;

/** A WordPress site's own search feed: every matching article, dated, no recency bias. */
async function searchFeed(base: string, source: string, company: string): Promise<Hit[]> {
  try {
    const r = await fetch(`${base}/?s=${encodeURIComponent(company)}&feed=rss2`, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const name = company.toLowerCase();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const item = m[1];
      const strip = (x?: string) => (x ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&#039;/g, "'").trim();
      const title = strip(/<title>([\s\S]*?)<\/title>/.exec(item)?.[1]);
      const desc = strip(/<description>([\s\S]*?)<\/description>/.exec(item)?.[1]);
      const pub = /<pubDate>([^<]*)<\/pubDate>/.exec(item)?.[1];
      return { url: strip(/<link>([\s\S]*?)<\/link>/.exec(item)?.[1]), title, desc, date: pub ? new Date(pub).toISOString() : null };
    })
      // WordPress search matched the full text. Rank: company in the headline or summary counts double, role words once.
      .filter(h => h.url.startsWith("http"))
      .map(({ desc, ...h }) => {
        const head = `${h.title} ${desc}`;
        return { ...h, source, via: "search_feed" as const, score: (head.toLowerCase().includes(name) ? 2 : 0) + (ROLE_WORDS.test(head) ? 1 : 0) };
      })
      .sort((a, b) => b.score - a.score).slice(0, 3);
  } catch { return []; }
}

/** SEC full-text search over 8-Ks: officer appointments (Item 5.02) name the person and title. */
async function sec8k(company: string): Promise<Hit[]> {
  const since = new Date(Date.now() - MAX_AGE_MONTHS * 30.44 * 864e5).toISOString().slice(0, 10);
  const q = `"${company}" ("Chief Marketing Officer" OR "Chief Brand Officer" OR "Chief Commercial Officer")`;
  try {
    const r = await fetch(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=8-K&dateRange=custom&startdt=${since}`, {
      headers: { "user-agent": "SyzygyBot/0.1 (Onenept Studios Inc.; contact via https://syzygybot.vercel.app)" }, signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { hits?: { hits?: { _id: string; _source: { ciks?: string[]; display_names?: string[]; file_date?: string } }[] } };
    return (j.hits?.hits ?? []).slice(0, 4).flatMap(h => {
      const [adsh, file] = h._id.split(":");
      const cik = h._source.ciks?.[0]?.replace(/^0+/, "");
      const named = (h._source.display_names ?? []).join(" ").toLowerCase();
      if (!cik || !file || !named.includes(company.toLowerCase().split(" ")[0])) return [];
      return [{ url: `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}/${file}`, title: `8-K, ${h._source.display_names?.[0] ?? company}`, date: h._source.file_date ?? null, source: "SEC EDGAR", via: "sec_8k" as const }];
    });
  } catch { return []; }
}

const EXTRACT_SYSTEM = `You read one article and list people it names as working at the given company in a marketing,
brand, partnerships, sponsorship, commercial, communications or executive role. Only people the text itself
names with a title at that company; never guess. Also list any email addresses the text prints for that company's
press, partnerships or marketing. Reply with JSON only: {"people":[{"name":"","title":""}],"inboxes":[""]}`;

/** Names and titles on one page, near the company's name. The Verifier still checks each one against the page. */
async function extract(page: Page, company: string) {
  const text = page.text, i = text.toLowerCase().indexOf(company.toLowerCase());
  if (i < 0) return { people: [], inboxes: [], cost: 0 };
  const window = text.slice(Math.max(0, i - 3000), i + 6000);
  const r = await ask("fast", EXTRACT_SYSTEM, JSON.stringify({ company, url: page.url, text: window }), 500);
  const j = parseJson<{ people?: { name: string; title: string }[]; inboxes?: string[] }>(r.text) ?? {};
  const people = (j.people ?? []).filter(p => p?.name && p?.title && text.includes(p.name)); // must literally appear
  const inboxes = (j.inboxes ?? []).filter(e => e?.includes("@") && text.toLowerCase().includes(e.toLowerCase()));
  return { people, inboxes, cost: r.costUsd ?? 0 };
}

export type SweepResult = {
  groups: string[]; sourcesConsidered: number; feedsSearched: number; queries: string[]; hits: Hit[]; pages: Page[];
  people: { name: string; title: string; source_url: string; source: string }[];
  inboxes: { email: string; source_url: string }[]; costUsd: number;
};

const SUFFIX = new Set(["cf", "fc", "afc", "sc", "inc", "inc.", "llc", "ltd", "ltd.", "plc", "co", "co.", "corp", "corp.", "s.p.a.", "spa", "s.a.", "sa", "gmbh", "ag", "nv", "bv", "group", "company"]);

/** How articles name a company: "Real Madrid CF" is written "Real Madrid", "Nike, Inc." is "Nike". */
export function searchName(name: string) {
  const words = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 1 && SUFFIX.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(" ");
}

/** Runs the sweep for one company. `tags` are its Qloo taste tags; `hq` its head-office city if known. */
export async function sweep(company: { name: string; type: string; tags?: string[]; hq?: string | null; publicCompany?: boolean }): Promise<SweepResult> {
  const groups = groupsFor(company.type, company.tags ?? [], company.hq ?? null);
  const name = searchName(company.name);
  // Industry trade press first, then marketing and PR trade press, then the general and official sources.
  const RANK = ["marketing", "pr", "media_business", "talent", "conference", "awards", "regional_eu", "regional_apac", "regional_americas_mea", "wire", "business", "registry"];
  const order = [...groups].sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b));
  const pool = order.flatMap(g => READABLE.filter(s => s.group === g && !s.domain.includes("/")));
  const queries: string[] = [`"${name}" ${ROLE_TERMS}`];
  for (let i = 0; i < pool.length && queries.length < MAX_QUERIES; i += SITES_PER_QUERY)
    queries.push(`"${name}" ${ROLE_TERMS} (${pool.slice(i, i + SITES_PER_QUERY).map(s => `site:${s.domain}`).join(" OR ")})`);

  const feeds = pool.filter(s => results[s.domain]?.search_feed).slice(0, MAX_FEEDS);
  const found = (await Promise.all([
    ...queries.map(bingNews),
    ...feeds.map(s => searchFeed(results[s.domain].search_feed!, s.name, name)),
    company.publicCompany === false ? Promise.resolve([]) : sec8k(name),
  ])).flat();
  const cutoff = Date.now() - MAX_AGE_MONTHS * 30.44 * 864e5;
  const seen = new Set<string>();
  const hits = found.filter(h => {
    if (seen.has(h.url)) return false; seen.add(h.url);
    if (h.date && Date.parse(h.date) < cutoff) return false;
    return h.via !== "bing_news" || !!sourceOf(h.url); // open-query results count only if the site is on the list
  }).sort((a, b) => (b.score ?? 2) - (a.score ?? 2) || Date.parse(b.date ?? "0") - Date.parse(a.date ?? "0"));

  const pages = (await readAll(hits.slice(0, MAX_PAGES).map(h => h.url), MAX_PAGES)).filter(p => p.status < 400);
  let cost = 0;
  const people: SweepResult["people"] = [], inboxes: SweepResult["inboxes"] = [];
  for (const p of pages) {
    const e = await extract(p, name);
    cost += e.cost;
    const src = hits.find(h => h.url === p.url)?.source ?? hostOf(p.url);
    for (const x of e.people) if (!people.some(y => y.name.toLowerCase() === x.name.toLowerCase())) people.push({ ...x, source_url: p.url, source: src });
    for (const m of e.inboxes) if (!inboxes.some(y => y.email.toLowerCase() === m.toLowerCase())) inboxes.push({ email: m, source_url: p.url });
  }
  return { groups, sourcesConsidered: pool.length, feedsSearched: feeds.length, queries, hits, pages, people, inboxes, costUsd: cost };
}
