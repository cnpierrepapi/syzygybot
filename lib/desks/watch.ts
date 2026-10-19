// Market Watch (agent: Watch). Reads the news around the clock for what this persona would act on, and says what to do
// about each item. Two steps, because Gemini drops its search citations when told to answer in JSON (and then invents
// outlets): 1) search and report in prose, with citations; 2) turn that into items that each point at a cited page.
// An item is kept only if we can open that page ourselves and it is dated inside the window.
import { sql } from "../db";
import { logAction } from "../actions";
import { ask, askWeb, parseJson } from "../llm";
import { readPage, resolveRedirect } from "../web";
import { desksFor, type Persona } from "../personas";

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export async function runWatch(p: Persona, take = 5) {
  const desks = desksFor(p).filter(d => d !== "watch");
  const days = 30, since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const r = await askWeb(`Search Google News for what happened in the last ${days} days (since ${since}) on each of these topics:
${p.watch.map((w, i) => `${i + 1}. ${w}`).join("\n")}
Report the ${take + 9} most useful real news items for ${p.title} (${p.forWhom}). For each: the headline, the outlet, the date, and two sentences on what happened.
Only items you found in search results. Write plain prose.`, "You are a news researcher for an entertainment partnerships desk. Use Google Search and cite what you find.", 2000);
  const sources = (await Promise.all(r.sources.slice(0, 16).map(async s => ({ title: s.title, url: await resolveRedirect(s.url) }))))
    .filter(s => s.url.startsWith("http") && !/vertexaisearch/.test(s.url));
  // Read every cited page first. The page's own title is the headline, so a headline can never sit on the wrong link,
  // and only pages that open and are dated inside the window count.
  const today = new Date().toISOString().slice(0, 10);
  const pages = (await Promise.all(sources.map(s => readPage(s.url)))).filter((x): x is NonNullable<typeof x> =>
    !!x && !!x.title && !!x.date && x.date.slice(0, 10) >= since && x.date.slice(0, 10) <= today);
  const unique = pages.filter((x, i) => pages.findIndex(y => y.url === x.url || y.title === x.title) === i);
  let kept = 0;
  if (unique.length) {
    const j = await ask("fast", `You are Market Watch for ${p.title}. ${p.who} Works for: ${p.forWhom}
For each numbered article, decide if it matters to this person. If it does, say why in one sentence and the concrete move in one sentence.
Drop anything off-topic. JSON only: {"items": [{"n": 0, "why": "", "move": "", "desk": "one of ${desks.join("|")}"}]}`,
      unique.map((x, i) => `[${i}] ${x.title} (${host(x.url)}, ${x.date!.slice(0, 10)})\n${x.text.slice(0, 600)}`).join("\n\n"), 1400);
    for (const it of parseJson<{ items: { n: number; why: string; move: string; desk: string }[] }>(j.text)?.items ?? []) {
      const page = unique[it.n];
      if (kept >= take || !page || !it.why) continue;
      const [row] = (await sql()`insert into watch_items (persona, headline, url, source, published, why, move, desk, dedupe)
        values (${p.id}, ${page.title}, ${page.url}, ${host(page.url)}, ${page.date!.slice(0, 10)}, ${it.why}, ${it.move || null}, ${desks.includes(it.desk as never) ? it.desk : null},
                ${`${p.id}|${page.url}`})
        on conflict (dedupe) do nothing returning id`) as { id: string }[];
      if (!row) continue;
      kept++;
      await logAction({ agent: "watch", kind: "watch.flagged", summary: `For ${p.title}: ${page.title}`, refTable: "watch_items", refId: row.id, detail: { persona: p.id, url: page.url } });
    }
  }
  await logAction({ agent: "watch", kind: "watch.read", summary: `Read the news for ${p.title}: ${r.queries.length} searches, ${sources.length} pages cited, ${kept} new items worth acting on.`, llmCostUsd: r.costUsd, detail: { persona: p.id, queries: r.queries } });
  return Array.from({ length: kept }, (_, i) => String(i));
}
