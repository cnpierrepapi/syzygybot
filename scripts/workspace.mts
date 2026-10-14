// npm run workspace -- "Bad Bunny"            -> creates (or finds) a brand's workspace by hand and prints its private link.
// npm run workspace -- confirm "Bad Bunny"    -> a person has checked a claim whose X handle only one source vouched for;
//                                                sending in the brand's name opens up.
// npm run workspace -- handoffs               -> open handoffs on SYZYGY's desk, with their private links.
// Brands normally claim their own page at /claim/<brand>; this is the manual side.
import { neon } from "@neondatabase/serverless";
import { token, SITE } from "../lib/slug";
const sql = neon(process.env.DATABASE_URL!);
const [cmd, arg] = process.argv.slice(2);

if (cmd === "handoffs") {
  const rows = await sql.query(`select token, status, simulated, packet->>'who' who, packet->>'company' company, created_at from handoffs where workspace_id is null and status = 'open' order by created_at`) as { token: string; status: string; simulated: boolean; who: string; company: string }[];
  if (!rows.length) console.log("No open handoffs.");
  for (const h of rows) console.log(`${h.who} at ${h.company}${h.simulated ? " (simulated)" : ""}\n  ${SITE}/handoff/${h.token}`);
  process.exit(0);
}
if (cmd === "confirm") {
  const rows = await sql.query(`update workspaces w set claim = claim || '{"needs_review": false, "reviewed": true}'::jsonb from entities e
    where e.qloo_id = w.entity_id and lower(e.name) = lower($1) and not w.demo and w.claimed_at is not null returning w.id`, [arg]);
  console.log(rows.length ? `${arg}: claim confirmed, sending in their name is open.` : `No claimed workspace for "${arg}".`);
  process.exit(0);
}
const name = cmd;
if (!name) { console.error('usage: npm run workspace -- "<entity name>" | confirm "<name>" | handoffs'); process.exit(1); }
const [e] = await sql.query(`select qloo_id, name from entities where lower(name) = lower($1) limit 1`, [name]) as { qloo_id: string; name: string }[];
if (!e) { console.error(`No entity called "${name}" yet.`); process.exit(1); }
let [w] = await sql.query(`select connect_token from workspaces where entity_id = $1 and not demo`, [e.qloo_id]) as { connect_token: string }[];
if (!w) [w] = await sql.query(`insert into workspaces (entity_id, name, connect_token) values ($1, $2, $3) returning connect_token`, [e.qloo_id, e.name, token(24)]) as { connect_token: string }[];
const [{ n }] = await sql.query(`select count(*)::int n from accounts where passed_on = $1`, [e.qloo_id]) as { n: number }[];
console.log(`${e.name}: ${n} companies need them.\n${SITE}/connect/${w.connect_token}`);
