// Google News search feed, with each item's link decoded to the publisher's own URL (replaced Bing News on 21 Oct, when
// Bing's RSS started returning empty feeds). The feed links are news.google.com redirects; the article page carries a
// signature and timestamp, and Google's own batchexecute call trades them for the real URL. Items are filtered on the
// publisher's domain BEFORE decoding, so only articles we would read cost the two extra requests.
const UA = "Mozilla/5.0 (compatible; SyzygyBot/0.1; +https://syzygybot.com)";
const clean = (s = "") => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
const decoded = new Map<string, string | null>();

export type GnewsHit = { url: string; title: string; date: string | null; source: string; domain: string };

/** One Google News link → the publisher URL, or null. */
export async function decodeGnews(link: string) {
  if (decoded.has(link)) return decoded.get(link)!;
  let url: string | null = null;
  try {
    const id = link.split("/articles/")[1]?.split("?")[0];
    if (id) {
      const page = await (await fetch(`https://news.google.com/rss/articles/${id}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) })).text();
      const sg = /data-n-a-sg="([^"]+)"/.exec(page)?.[1], ts = /data-n-a-ts="([^"]+)"/.exec(page)?.[1];
      if (sg && ts) {
        const req = [[["Fbv4je", `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`, null, "generic"]]];
        const r = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": UA },
          body: `f.req=${encodeURIComponent(JSON.stringify(req))}`, signal: AbortSignal.timeout(12000),
        });
        url = /\\"garturlres\\",\\"(https?:[^\\"]+)/.exec(await r.text())?.[1] ?? null;
      }
    }
  } catch { url = null; }
  decoded.set(link, url);
  return url;
}

/** Search Google News; keep items whose publisher domain passes `keep`, decode up to `max` of them. */
export async function googleNews(q: string, opts: { keep?: (domain: string) => boolean; max?: number } = {}): Promise<GnewsHit[]> {
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const items = [...(await r.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const it = m[1], src = /<source url="([^"]+)"[^>]*>([^<]*)<\/source>/.exec(it);
      const domain = (() => { try { return new URL(src?.[1] ?? "").hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } })();
      const outlet = clean(src?.[2]);
      const title = clean(/<title>([\s\S]*?)<\/title>/.exec(it)?.[1]).replace(new RegExp(`\\s+-\\s+${outlet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
      const pub = /<pubDate>([^<]*)<\/pubDate>/.exec(it)?.[1];
      return { link: clean(/<link>([^<]*)<\/link>/.exec(it)?.[1]), title, date: pub ? new Date(pub).toISOString() : null, source: outlet || domain, domain };
    }).filter(x => x.link && (!opts.keep || opts.keep(x.domain))).slice(0, opts.max ?? 8);
    const out: GnewsHit[] = [];
    for (const x of items) { const url = await decodeGnews(x.link); if (url) out.push({ url, title: x.title, date: x.date, source: x.source, domain: x.domain }); }
    return out;
  } catch { return []; }
}
