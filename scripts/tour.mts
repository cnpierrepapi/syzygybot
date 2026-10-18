// npm run tour -- "Charli XCX"            -> fan cities from Qloo, then the rooms that fit, per city
// npm run tour -- "Charli XCX" read       -> also read what the shortlisted rooms book (web, ~$0.02 each) and re-rank
import { planTour } from "../lib/tour";
import { profileVenue } from "../lib/venues";

const [name, mode] = process.argv.slice(2);
let plan = await planTour(name ?? "");
if (!plan) { console.log(`"${name}" isn't an artist or show in the Qloo corpus yet.`); process.exit(0); }
if (mode === "read") {
  // Read rooms until every city's shortlist is made of rooms we've actually read (inactive ones drop out as we go).
  for (let round = 0; round < 3; round++) {
    const todo = plan.stops.flatMap(s => s.rooms).filter(r => r.needsRead);
    if (!todo.length) break;
    let failed = 0;
    for (let i = 0; i < todo.length; i += 2)
      await Promise.all(todo.slice(i, i + 2).map(r => profileVenue(r.id).catch(e => { failed++; console.log(`  read failed: ${r.name}: ${(e as Error).message.slice(0, 80)}`); })));
    console.log(`round ${round + 1}: read ${todo.length} rooms, ${failed} failed`);
    plan = (await planTour(name))!;
  }
}
console.log(`${plan.artist}: Qloo popularity ${plan.popularity}, usual room ${plan.roomSize[0]}-${plan.roomSize[1]}`);
for (const s of plan.stops) {
  console.log(`\n${s.metro} (fan weight ${s.fanWeight})`);
  for (const r of s.rooms)
    console.log(`  ${r.name} ~${r.capacity}${r.liveNation ? " [Live Nation]" : ""}  taste ${r.tasteMatch ?? "unread"}  size ${r.sizeFit}${r.recentActs.length ? `  recent: ${r.recentActs.join(", ")}` : ""}`);
}
