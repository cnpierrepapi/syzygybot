// Market Watch (agent: Watch). Reads the news around the clock for what this persona would act on, and says what to do
// about each item. It reads feeds, not pages: Google News RSS for the persona's searches, plus the search feeds of the
// curated trade press (lib/sources.ts) in the persona's groups. Feeds carry the publisher's own headline, link and date,
// so nothing is guessed and nothing has to be scraped. Gemini only judges which items matter and writes the move.
// (19 Oct: the first version asked Gemini's grounded search for JSON; it dropped its citations and invented outlets.)
import { sql } from "../db";
import { logAction } from "../actions";
import { ask, parseJson } from "../llm";
import { feedSources, sourceOf } from "../sweep";
import { desksFor, type Persona } from "../personas";

const UA = "Mozilla/5.0 (compatible; SyzygyBot/0.1; +https://syzygybot.com)";
const DAYS = 30;

type Item = { title: string; url: string; source: string; date: string; summary: string; curated: boolean; via: "google_news" | "trade_feed" };

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const clean = (x?: string) => (x ?? "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&#8217;|&apos;/g, "'")
  .replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const tag = (item: string, t: string) => clean(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(item)?.[1]);

async function rss(url: string) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    return r.ok ? [...(await r.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]) : [];
  } catch { return []; }
}

/** Google News: headline ends in " - Outlet"; <source url> is the publisher. */
async function googleNews(q: string): Promise<Item[]> {
  const items = await rss(`https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${DAYS}d`)}&hl=en-US&gl=US&ceid=US:en`);
  return items.map(it => {
    const src = /<source url="([^"]+)"[^>]*>([^<]*)<\/source>/.exec(it);
    const outlet = clean(src?.[2]);
    const title = tag(it, "title").replace(new RegExp(`\\s+-\\s+${outlet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
    const pub = tag(it, "pubDate");
    const site = src?.[1] ?? "";
    return { title, url: tag(it, "link"), source: outlet || host(site), date: pub ? new Date(pub).toISOString() : "", summary: "", curated: !!sourceOf(site), via: "google_news" as const };
  }).filter(x => x.title && x.url && x.date);
}

/** A curated trade site's own search feed for one query. */
async function tradeFeed(feed: string, name: string, q: string): Promise<Item[]> {
  const words = q.replace(/["()]|\bOR\b/g, " ").split(/\s+/).filter(w => w.length > 3).slice(0, 4).join(" ");
  const items = await rss(`${feed}/?s=${encodeURIComponent(words)}&feed=rss2`);
  return items.map(it => {
    const pub = tag(it, "pubDate");
    return { title: tag(it, "title"), url: tag(it, "link"), source: name, date: pub ? new Date(pub).toISOString() : "", summary: tag(it, "description").slice(0, 300), curated: true, via: "trade_feed" as const };
  }).filter(x => x.title && x.url.startsWith("http") && x.date);
}

export async function runWatch(p: Persona, take = 6) {
  const desks = desksFor(p).filter(d => d !== "watch");
  const since = Date.now() - DAYS * 864e5;
  const feeds = feedSources(p.groups).slice(0, 12);
  const found = (await Promise.all([
    ...p.news.map(googleNews),
    // Each trade feed gets the persona's first two searches; their archives are smaller, so a broad query is fine.
    ...feeds.flatMap(f => p.news.slice(0, 2).map(q => tradeFeed(f.feed, f.name, q))),
  ])).flat().filter(x => Date.parse(x.date) >= since && Date.parse(x.date) <= Date.now() + 864e5);
  // One row per story: the same headline from several outlets keeps the curated or earliest copy.
  const seen = new Map<string, Item>();
  for (const x of found.sort((a, b) => Number(b.curated) - Number(a.curated) || Date.parse(b.date) - Date.parse(a.date))) {
    const k = x.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").slice(0, 70);
    if (!seen.has(k)) seen.set(k, x);
  }
  const known = new Set(((await sql()`select url from watch_items where persona = ${p.id}`) as { url: string }[]).map(r => r.url));
  const pool = [...seen.values()].filter(x => !known.has(x.url)).slice(0, 40);
  let kept = 0, cost = 0;
  if (pool.length) {
    const j = await ask("fast", `You are Market Watch for ${p.title}. ${p.who} Works for: ${p.forWhom}
Pick the ${take} items that matter most to this person, newest and most actionable first. Skip anything off-topic, gossip or duplicates.
For each: why it matters in one plain sentence, and the concrete move in one sentence, naming which desk acts.
JSON only: {"items": [{"n": 0, "why": "", "move": "", "desk": "one of ${desks.join("|")}"}]}`,
      pool.map((x, i) => `[${i}] ${x.title} (${x.source}, ${x.date.slice(0, 10)})${x.summary ? ` ${x.summary}` : ""}`).join("\n"), 1600);
    cost += j.costUsd ?? 0;
    for (const it of parseJson<{ items: { n: number; why: string; move: string; desk: string }[] }>(j.text)?.items ?? []) {
      const x = pool[it.n];
      if (kept >= take || !x || !it.why) continue;
      const [row] = (await sql()`insert into watch_items (persona, headline, url, source, published, why, move, desk, dedupe)
        values (${p.id}, ${x.title}, ${x.url}, ${x.source}, ${x.date.slice(0, 10)}, ${it.why}, ${it.move || null}, ${desks.includes(it.desk as never) ? it.desk : null},
                ${`${p.id}|${x.url}`})
        on conflict (dedupe) do nothing returning id`) as { id: string }[];
      if (!row) continue;
      kept++;
      await logAction({ agent: "scout", kind: "watch.flagged", summary: `For ${p.title}: ${x.title} (${x.source})`, refTable: "watch_items", refId: row.id, detail: { persona: p.id, url: x.url, via: x.via } });
    }
  }
  await logAction({
    agent: "scout", kind: "watch.read", llmCostUsd: cost, detail: { persona: p.id, searches: p.news, tradeFeeds: feeds.map(f => f.domain) },
    summary: `Read the news for ${p.title}: ${p.news.length} searches and ${feeds.length} trade-press feeds, ${seen.size} stories from the last ${DAYS} days, ${kept} worth acting on.`,
  });
  return Array.from({ length: kept }, (_, i) => String(i));
}
