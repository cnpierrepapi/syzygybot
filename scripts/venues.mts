// npm run venues -- import data/venues-raw.json   -> load rooms (from the Wikidata pull) into the venues table
// npm run venues -- score                         -> book/sponsor fits for every room from the Qloo corpus
// npm run venues -- top [metro]                    -> the best-scored rooms
import { sql } from "../lib/db";
import { importVenues, scoreVenues } from "../lib/venues";
const [cmd, arg] = process.argv.slice(2);
if (cmd === "import") console.log(await importVenues(arg ?? "data/venues-raw.json"), "rooms");
else if (cmd === "score") console.log(await scoreVenues());
else {
  const rows = await sql()`select v.name, v.metro, v.capacity_est cap, v.live_nation ln, round(v.score::numeric, 3) score,
    (select string_agg(entity_name, ', ' order by fit desc) from (select entity_name, fit from venue_fits f where f.venue_id = v.id and role = 'book' order by fit desc limit 3) t) book,
    (select string_agg(entity_name, ', ' order by fit desc) from (select entity_name, fit from venue_fits f where f.venue_id = v.id and role = 'sponsor' order by fit desc limit 3) t) sponsor
    from venues v where (${arg ?? null}::text is null or v.metro = ${arg ?? null}) and v.score > 0 order by v.score desc limit 15`;
  for (const r of rows as any[]) console.log(`${r.score}  ${r.name} (${r.metro}, ~${r.cap}${r.ln ? ", Live Nation" : ""})  book: ${r.book}  |  sponsor: ${r.sponsor}`);
}
