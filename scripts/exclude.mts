// npm run exclude -- "Brand name" [reason]  -> Scout never picks this brand
// npm run exclude                           -> list the hand-kept exclude list
import { sql } from "../lib/db";
import { search } from "../lib/qloo";

const [name, reason] = process.argv.slice(2);
if (!name) console.log(await sql()`select name, reason, added_at from scout_exclude order by added_at desc`);
else {
  const [e] = await search(name, "brand", 1);
  if (!e) { console.error(`No Qloo brand found for "${name}".`); process.exit(1); }
  await sql()`insert into scout_exclude (entity_id, name, reason) values (${e.entity_id}, ${e.name}, ${reason ?? "added by hand"}) on conflict do nothing`;
  await sql()`update pair_queue set status = 'skipped', note = 'excluded' where status = 'queued' and ${e.entity_id} in (a_id, b_id)`;
  console.log(`Excluded ${e.name}.`);
}
