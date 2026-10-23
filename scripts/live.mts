// npm run live -- <persona-id>   -> starts (or joins) a live desk run and prints its steps as they land
import { execute, snapshot, startOrJoin } from "../lib/live/run";

const id = process.argv[2] ?? "cedric-brands";
const r = await startOrJoin(id, "again");
if (!r.id) { console.error(r.why); process.exit(1); }
const t0 = Date.now();
const work = r.fresh ? execute(r.id) : Promise.resolve();
const seen = new Set<string>();
const tick = async () => {
  const s = await snapshot(r.id!);
  for (const x of [...(s?.log ?? []), ...(s?.cards.flatMap(c => c.steps) ?? [])].sort((a, b) => a.at.localeCompare(b.at))) {
    const k = `${x.at}|${x.summary}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`${((+new Date(x.at) - t0) / 1000).toFixed(0).padStart(4)}s  col ${x.col ?? "-"}  ${x.agent.padEnd(14)} ${x.summary}`);
  }
  return s;
};
const poll = setInterval(tick, 2000);
await work;
clearInterval(poll);
const s = await tick();
console.log(`\n${s?.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s · ${s?.qloo_calls} Qloo calls · ${s?.cards.length} cards${s?.error ? ` · ${s.error}` : ""}`);
