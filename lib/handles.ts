// X handle lookup. A handle counts as verified only when two independent sources agree:
// Qloo's external.twitter, Wikidata P2002, and the brand's own website.

import type { QlooEntity } from "./qloo";

export type HandleSource = { source: "qloo" | "wikidata" | "site"; handle: string; url?: string };

const UA = "SyzygyBot/0.1 (+https://syzygybot.vercel.app)";
const NOT_HANDLES = new Set(["intent", "share", "home", "search", "i", "hashtag", "login", "signup", "explore", "settings", "tos", "privacy"]);

const norm = (h: string) => h.replace(/^@/, "").trim().toLowerCase();

/** Pulls string ids out of Qloo's external.<key> field, whatever shape it comes in. */
export function externalIds(e: QlooEntity, key: string): string[] {
  const v = e.properties?.external?.[key];
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === "string") out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      walk(o.id ?? o.username ?? o.handle);
    }
  };
  walk(v);
  return out;
}

/** Matches x.com / twitter.com links without tripping on "netflix.com". */
export function handlesInHtml(html: string): string[] {
  const re = /(?<![\w.])(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_])/g;
  const found = new Set<string>();
  for (const m of html.matchAll(re)) if (!NOT_HANDLES.has(m[1].toLowerCase())) found.add(m[1]);
  return [...found];
}

async function fetchText(url: string, ms = 8000) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(ms), redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export async function wikidataHandles(qid: string): Promise<string[]> {
  const j = JSON.parse(await fetchText(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`));
  const claims = j.entities?.[qid]?.claims?.P2002 ?? [];
  return claims.map((c: { mainsnak?: { datavalue?: { value?: string } } }) => c.mainsnak?.datavalue?.value).filter(Boolean);
}

export interface HandleResult {
  handle: string | null;
  status: "verified" | "review" | "none";
  sources: HandleSource[];
  wikidata: string | null;
  officialSite: string | null;
}

export async function resolveHandle(e: QlooEntity): Promise<HandleResult> {
  const sources: HandleSource[] = [];
  for (const h of externalIds(e, "twitter")) sources.push({ source: "qloo", handle: h });

  const wikidata = externalIds(e, "wikidata").find(id => /^Q\d+$/.test(id)) ?? null;
  if (wikidata) {
    try {
      for (const h of await wikidataHandles(wikidata))
        sources.push({ source: "wikidata", handle: h, url: `https://www.wikidata.org/wiki/${wikidata}` });
    } catch { /* Wikidata down or rate-limited: one source fewer */ }
  }

  const officialSite = typeof e.properties?.official_site === "string" ? e.properties.official_site : null;
  if (officialSite) {
    try {
      for (const h of handlesInHtml(await fetchText(officialSite))) sources.push({ source: "site", handle: h, url: officialSite });
    } catch { /* site blocks bots or times out */ }
  }

  // A handle wins if at least two DIFFERENT sources name it.
  const bySource = new Map<string, Set<string>>();
  for (const s of sources) {
    const k = norm(s.handle);
    if (!bySource.has(k)) bySource.set(k, new Set());
    bySource.get(k)!.add(s.source);
  }
  const ranked = [...bySource.entries()].sort((a, b) => b[1].size - a[1].size);
  const top = ranked[0];
  if (top && top[1].size >= 2) {
    const original = sources.find(s => norm(s.handle) === top[0])!.handle.replace(/^@/, "");
    return { handle: original, status: "verified", sources, wikidata, officialSite };
  }
  if (top) {
    const original = sources.find(s => norm(s.handle) === top[0])!.handle.replace(/^@/, "");
    return { handle: original, status: "review", sources, wikidata, officialSite };
  }
  return { handle: null, status: "none", sources, wikidata, officialSite };
}
