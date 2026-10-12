// npm run scout                      -> least-recently scouted seed
// npm run scout -- "A24" brand       -> a specific seed
import { runScout } from "../lib/scout";
import type { EntityType } from "../lib/qloo";

const [name, type] = process.argv.slice(2);
const results = await runScout(name ? { seed: { name, type: (type ?? "brand") as EntityType } } : {});
for (const r of results) console.log(`${r.band.padEnd(5)} ${r.score.toFixed(3)}  ${r.a} × ${r.b}  /thesis/${r.pairId}${r.gate ? `  (${r.gate})` : ""}`);
