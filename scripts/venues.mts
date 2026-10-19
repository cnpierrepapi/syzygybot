// npm run venues -- import data/venues-raw.json   -> load rooms (from the Wikidata pull) into the venues table
// npm run venues -- clean                         -> drop duplicates and gone rooms, fix known capacities
// npm run venues -- remetro                       -> file each room under its nearest metro
// npm run venues -- score                         -> book/sponsor fits for every room from the Qloo corpus
// npm run venues -- profile [perMetro]             -> read what the top rooms book (web, ~$0.02 each), then rescore
// npm run venues -- top [metro]                    -> the best-scored rooms
import { sql } from "../lib/db";
import { cleanVenues, importVenues, profileVenue, remetro, scoreVenues, venuesToProfile } from "../lib/venues";
const [cmd, arg] = process.argv.slice(2);
if (cmd === "import") console.log(await importVenues(arg ?? "data/venues-raw.json"), "rooms");
else if (cmd === "clean") console.log(await cleanVenues());
else if (cmd === "remetro") console.log(await remetro(), "rooms moved to their nearest metro");
else if (cmd === "score") console.log(await scoreVenues());
else if (cmd === "profile") {
  const ids = await venuesToProfile(Number(arg ?? 3));
  let cost = 0, i = 0;
  const one = async ({ id }: { id: string }) => {
    try { const p = await profileVenue(id); cost += p.costUsd; console.log(`${++i}/${ids.length} ${p.tags.length} tags, ${p.recentActs.length} acts, ${p.confidence}`); }
    catch (e) { console.log(`${++i}/${ids.length} failed: ${(e as Error).message.slice(0, 80)}`); }
  };
  for (let k = 0; k < ids.length; k += 4) await Promise.all(ids.slice(k, k + 4).map(one)); // four web reads at a time
  console.log(`profiled ${ids.length} rooms, ~$${cost.toFixed(2)}`);
}
else {
  const rows = await sql()`select v.name, v.metro, v.capacity_est cap, v.live_nation ln, round(v.score::numeric, 3) score,
    (select string_agg(entity_name, ', ' order by fit desc) from (select entity_name, fit from venue_fits f where f.venue_id = v.id and role = 'book' order by fit desc limit 3) t) book,
    (select string_agg(entity_name, ', ' order by fit desc) from (select entity_name, fit from venue_fits f where f.venue_id = v.id and role = 'sponsor' order by fit desc limit 3) t) sponsor
    from venues v where (${arg ?? null}::text is null or v.metro = ${arg ?? null}) and v.score > 0 order by v.score desc limit 15`;
  for (const r of rows as any[]) console.log(`${r.score}  ${r.name} (${r.metro}, ~${r.cap}${r.ln ? ", Live Nation" : ""})  book: ${r.book}  |  sponsor: ${r.sponsor}`);
}
