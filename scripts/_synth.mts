// Lab: rebuild a brand's Qloo-style audience tags from public web sources, restricted to our tag vocabulary.
import { readFileSync, writeFileSync } from "node:fs";
import { askWeb, parseJson } from "../lib/llm";
const vocab: string[] = JSON.parse(readFileSync("data/vocab.json", "utf8"));
const [out, ...names] = process.argv.slice(2);
const SYSTEM = `You build taste profiles in the style of Qloo's audience tags. Research the brand, company or person on the web: what it sells, who buys it,
its price point, where it sells, its collaborations, the music, TV, film and lifestyle its customers are into.
Then pick 35 to 50 tags ONLY from the provided vocabulary that best describe (a) the brand itself and (b) the wider tastes of its audience,
including the music genres and TV/film themes that audience likes. Also give its audience age split and the US metros where its audience concentrates.
Reply with JSON only: {"tags": [...], "age": {"24_and_younger": 0-1, "25_to_29": .., "30_to_34": .., "35_to_44": .., "45_to_54": .., "55_and_older": ..},
"metros": ["Los Angeles", ...], "summary": "one sentence", "confidence": "high|medium|low"}`;
const res: Record<string, unknown> = {};
let cost = 0;
for (const name of names) {
  const r = await askWeb(`Brand: ${name}\n\nVocabulary (choose only from these):\n${vocab.join(", ")}`, SYSTEM, 1500);
  const j = parseJson<{ tags: string[] }>(r.text);
  const valid = (j?.tags ?? []).filter(t => vocab.includes(t));
  res[name] = { ...j, tags: valid, dropped: (j?.tags ?? []).length - valid.length, sources: r.sources.slice(0, 8) };
  cost += r.costUsd;
  console.log(name, valid.length, "tags", j ? "" : "(no JSON)");
}
writeFileSync(out, JSON.stringify(res, null, 1));
console.log("cost $" + cost.toFixed(3));
