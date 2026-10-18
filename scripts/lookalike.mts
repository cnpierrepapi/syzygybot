// npm run lookalike -- brand "Setta Wines" "Napa wine label founded by Cedric the Entertainer"
// npm run lookalike -- talent "Cedric the Entertainer" "comedian, actor, host"
// npm run lookalike -- from data/synth-cedric.json   -> store profiles already synthesized (no new web searches)
import { readFileSync } from "node:fs";
import { lookalike, type Synth } from "../lib/lookalike";

const show = (r: Awaited<ReturnType<typeof lookalike>>, name: string) => {
  console.log(`\n${name}: look-alikes ${r.strength}: ${r.lookalikes.map(l => `${l.name} ${l.similarity}`).join(", ")}`);
  for (const p of r.partners.slice(0, 6)) {
    const e = p.evidence[0];
    console.log(`  ${String(p.matchPct).padStart(3)}%  ${p.name} (${p.type})  e.g. Qloo: ${e.lookalike} ${e.toward}/${e.back} ${e.band}`);
  }
};
const [mode, a, b] = process.argv.slice(2);
if (mode === "from") {
  const all = JSON.parse(readFileSync(a, "utf8")) as Record<string, Synth & { sources: Synth["sources"] }>;
  for (const [key, s] of Object.entries(all)) {
    const name = key.split(" (")[0], description = key.slice(name.length + 2, -1);
    const kind = /comedian|actor|singer|rapper|band\b/i.test(description) && !/brand|label|line|company/i.test(description) ? "talent" : "brand";
    show(await lookalike(name, description, kind, { ...s, costUsd: 0 }), name);
  }
} else if (mode === "brand" || mode === "talent") show(await lookalike(a, b ?? "", mode), a);
else console.log("usage: lookalike brand|talent <name> <description> | from <file.json>");
