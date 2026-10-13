// Reading public web pages for the Verifier: follow search redirects, strip to text, find a date.

const UA = "Mozilla/5.0 (compatible; SyzygyBot/0.1; +https://syzygybot.vercel.app)";

export type Page = { url: string; status: number; text: string; date: string | null; emails: string[] };

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">", rsquo: "'", lsquo: "'", ndash: "-", mdash: "-" };

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+|#\d+|#x[0-9a-f]+);/gi, (m, k: string) => {
      if (ENTITIES[k.toLowerCase()]) return ENTITIES[k.toLowerCase()];
      if (!k.startsWith("#")) return m;
      const n = k[1].toLowerCase() === "x" ? parseInt(k.slice(2), 16) : Number(k.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    })
    .replace(/\s+/g, " ");
}

export function pageDate(html: string): string | null {
  const pats = [
    /"datePublished"\s*:\s*"([^"]+)"/, /property="article:published_time"\s+content="([^"]+)"/,
    /content="([^"]+)"\s+property="article:published_time"/, /<time[^>]+datetime="([^"]+)"/, /"dateModified"\s*:\s*"([^"]+)"/,
  ];
  for (const p of pats) {
    const m = p.exec(html)?.[1];
    if (m && !Number.isNaN(Date.parse(m))) return new Date(m).toISOString().slice(0, 10);
  }
  return null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Grounding results arrive as vertexaisearch redirect links; read the Location header instead of the page. */
export async function resolveRedirect(url: string): Promise<string> {
  if (!url.includes("grounding-api-redirect")) return url;
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    return r.headers.get("location") ?? url;
  } catch { return url; }
}

/**
 * URLs come from model output and search results, so only public web addresses get fetched: http(s),
 * a real hostname, never localhost, a bare IP, or an internal name. Stops the bot being pointed at
 * private infrastructure (SSRF).
 */
export function fetchable(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return false;
  if (/^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return false; // IPv4 / IPv6 literals
  if (u.username || u.password) return false;
  return !/linkedin\.com$/.test(h); // never read LinkedIn
}

const MAX_BYTES = 3_000_000;

export async function readPage(url: string): Promise<Page | null> {
  if (!fetchable(url)) return null;
  try {
    // Follow redirects by hand so every hop is checked before it's requested.
    let r: Response | null = null, at = url;
    const deadline = AbortSignal.timeout(10000);
    for (let hop = 0; hop < 5; hop++) {
      r = await fetch(at, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "manual", signal: deadline });
      const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
      if (!next) break;
      await r.body?.cancel();
      at = new URL(next, at).toString();
      if (!fetchable(at)) return null;
      r = null;
    }
    if (!r) return null;
    // Only pages and plain text; skip PDFs, images, video, and anything huge.
    const type = r.headers.get("content-type") ?? "";
    if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) { await r.body?.cancel(); return null; }
    if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) { await r.body?.cancel(); return null; }
    const html = (await r.text()).slice(0, 1_500_000);
    const mailto = [...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map(m => decodeURIComponent(m[1]));
    const text = htmlToText(html);
    const emails = [...new Set([...mailto, ...(text.match(EMAIL) ?? [])].map(e => e.toLowerCase()))];
    return { url: at, status: r.status, text, date: pageDate(html), emails };
  } catch { return null; }
}

/** Reads cited pages and search results together; model-written URLs are often wrong, search results are real. */
export async function readAll(urls: string[], max = 14) {
  const unique = [...new Set(urls.filter(Boolean))].slice(0, max);
  const pages = await Promise.all(unique.map(async u => readPage(await resolveRedirect(u))));
  return pages.filter((p): p is Page => p != null && p.status < 400);
}

const STOP = new Set(["about", "after", "their", "there", "which", "with", "from", "this", "that", "will", "into", "launch", "launched", "announced", "campaign", "partnership", "marketing", "brand", "featuring", "major", "new"]);

/** A claim counts as sourced when one readable page names the subject and most of the claim's distinctive words. */
export function pageBacking(pages: Page[], subject: string, claim: string) {
  const words = [...new Set(claim.toLowerCase().match(/[a-z0-9']{5,}/g) ?? [])].filter(w => !STOP.has(w));
  const need = Math.min(3, words.length);
  const head = subject.toLowerCase();
  for (const p of pages) {
    const t = p.text.toLowerCase();
    if (!t.includes(head)) continue;
    if (words.filter(w => t.includes(w)).length >= Math.max(need, Math.ceil(words.length * 0.5))) return p;
  }
  return null;
}

/** Does the domain accept mail at all? DNS over HTTPS, so it works on Vercel. */
export async function hasMx(domain: string): Promise<boolean> {
  try {
    const j = await (await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, { signal: AbortSignal.timeout(6000) })).json();
    return Array.isArray(j.Answer) && j.Answer.some((a: { type: number }) => a.type === 15);
  } catch { return false; }
}

export const monthsAgo = (iso: string | null) => (iso ? (Date.now() - Date.parse(iso)) / (30.44 * 864e5) : null);
