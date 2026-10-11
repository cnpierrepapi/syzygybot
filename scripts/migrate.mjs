import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
const sql = neon(url);
const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .split(/;\s*\n/).map(s => s.replace(/--.*$/gm, "").trim()).filter(Boolean);
for (const s of statements) await sql.query(s);
const t = await sql.query("select table_name from information_schema.tables where table_schema='public' order by 1");
console.log("tables:", t.map(r => r.table_name).join(", "));
