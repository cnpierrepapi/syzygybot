// npm run workspace -- "Bad Bunny"  -> creates (or finds) the workspace for a brand and prints its private connect link.
// Until the claim flow exists, this is how a brand gets its page.
import { neon } from "@neondatabase/serverless";
import { token, SITE } from "../lib/slug";
const sql = neon(process.env.DATABASE_URL!);
const name = process.argv[2];
if (!name) { console.error('usage: npm run workspace -- "<entity name>"'); process.exit(1); }
const [e] = await sql.query(`select qloo_id, name from entities where lower(name) = lower($1) limit 1`, [name]) as { qloo_id: string; name: string }[];
if (!e) { console.error(`No entity called "${name}" yet.`); process.exit(1); }
let [w] = await sql.query(`select connect_token from workspaces where entity_id = $1`, [e.qloo_id]) as { connect_token: string }[];
if (!w) [w] = await sql.query(`insert into workspaces (entity_id, name, connect_token) values ($1, $2, $3) returning connect_token`, [e.qloo_id, e.name, token(24)]) as { connect_token: string }[];
const [{ n }] = await sql.query(`select count(*)::int n from accounts where passed_on = $1`, [e.qloo_id]) as { n: number }[];
console.log(`${e.name}: ${n} companies need them.\n${SITE}/connect/${w.connect_token}`);
