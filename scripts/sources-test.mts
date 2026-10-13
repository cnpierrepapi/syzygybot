// npm run sources:test  -> checks every source with our honest user agent; writes data/sources-status.json
import { writeFileSync } from "node:fs";
import { SOURCES } from "../lib/sources";
const UA = "Mozilla/5.0 (compatible; SyzygyBot/0.1; +https://syzygybot.vercel.app)";

/** True if robots.txt bars us (or everyone) from the whole site. */
function robotsBlocks(txt: string) {
  let applies = false, blocked = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [k, ...v] = line.split(":"); const val = v.join(":").trim();
    if (/^user-agent$/i.test(k)) applies = val === "*" || /syzygybot/i.test(val);
    else if (applies && /^disallow$/i.test(k) && val === "/") blocked = true;
  }
  return blocked;
}

type Result = { status: number; final?: string; robots_block?: boolean; error?: string };

async function check(domain: string, timeout = 12000, www = false): Promise<Result> {
  const host = (www ? "www." : "") + domain.split("/")[0];
  const path = domain.includes("/") ? domain.slice(domain.indexOf("/")) : "";
  const get = (u: string) => fetch(u, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
  try {
    const [home, robots] = await Promise.all([get(`https://${host}${path}`), get(`https://${host}/robots.txt`).catch(() => null)]);
    const robotsTxt = robots && robots.ok ? await robots.text() : "";
    return { status: home.status, final: home.url, robots_block: robotsBlocks(robotsTxt) };
  } catch (e) { return { status: 0, error: (e as Error).cause ? String((e as any).cause.code ?? (e as Error).message) : (e as Error).message }; }
}

/** Slow second pass for anything that failed: longer timeout, then the www. host. */
async function retry(domain: string): Promise<Result> {
  const a = await check(domain, 25000);
  if (a.status) return a;
  const b = await check(domain, 25000, true);
  return b.status ? b : a;
}

const uniq = [...new Set(SOURCES.map(s => s.domain))];
const out: Record<string, unknown> = {};
let i = 0;
await Promise.all(Array.from({ length: 16 }, async () => { while (i < uniq.length) { const d = uniq[i++]; out[d] = await check(d); } }));
const failed = uniq.filter(d => !(out[d] as Result).status);
let j = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (j < failed.length) { const d = failed[j++]; out[d] = await retry(d); } }));
// Readable sources that answer a WordPress search feed give the sweep dated, complete search results.
async function feed(domain: string, final?: string) {
  const base = final ? new URL(final).origin : `https://${domain}`;
  try {
    const r = await fetch(`${base}/?s=marketing&feed=rss2`, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    return r.ok && /<item>/.test(await r.text()) ? base : null;
  } catch { return null; }
}
const ok = uniq.filter(d => { const r = out[d] as Result; return r.status >= 200 && r.status < 400 && !r.robots_block && !d.includes("/"); });
let k = 0;
await Promise.all(Array.from({ length: 10 }, async () => { while (k < ok.length) { const d = ok[k++]; const f = await feed(d, (out[d] as Result).final); if (f) (out[d] as Record<string, unknown>).search_feed = f; } }));
console.log("search feeds:", ok.filter(d => (out[d] as Record<string, unknown>).search_feed).length);
const rows = Object.values(out) as { status: number; robots_block?: boolean }[];
const readable = rows.filter(r => r.status >= 200 && r.status < 400 && !r.robots_block).length;
writeFileSync(new URL("../data/sources-status.json", import.meta.url), JSON.stringify({ checked_at: new Date().toISOString(), user_agent: UA, results: out }, null, 1));
const tally: Record<string, number> = {}; for (const r of rows) { const k = r.status === 0 ? "unreachable" : r.robots_block ? "robots blocks" : String(r.status); tally[k] = (tally[k] ?? 0) + 1; }
console.log({ sources: uniq.length, readable, tally });
