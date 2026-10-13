// Readable addresses for every public page: /account/ray-ban, /thesis/bad-bunny-x-ray-ban,
// /contact/federico-foschini, /message/federico-foschini-1. Old UUID links still work and redirect.
// Opt-out links are the one exception: they use a short random token, so nobody can guess someone
// else's opt-out address from a name.

import { randomBytes } from "node:crypto";
import { sql } from "./db";

export const SITE = "https://syzygybot.vercel.app";

export function slugify(s: string, max = 60) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, max).replace(/-+$/, "") || "item";
}

const B62 = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const token = (n = 8) => [...randomBytes(n)].map(b => B62[b % B62.length]).join("");

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Public path per table. */
export const ROUTE: Record<string, string> = {
  pairs: "/thesis/", accounts: "/account/", contacts: "/contact/", plans: "/plan/", touches: "/message/", replies: "/reply/",
};
export const pathFor = (table: string, slug: string | null | undefined, id: string) => `${ROUTE[table]}${slug ?? id}`;

function unique(base: string, taken: Set<string>) {
  let s = base, n = 2;
  while (taken.has(s)) s = `${base}-${n++}`;
  taken.add(s);
  return s;
}

type Row = { id: string; base: string };

async function fill(table: string, rows: Row[]) {
  if (!rows.length) return 0;
  const taken = new Set(((await sql().query(`select slug from ${table} where slug is not null`)) as { slug: string }[]).map(r => r.slug));
  for (const r of rows) await sql().query(`update ${table} set slug = $1 where id = $2 and slug is null`, [unique(slugify(r.base), taken), r.id]);
  return rows.length;
}

/** Gives every row without a slug its readable address. Cheap when nothing is missing; agents call it after they write. */
export async function fillSlugs() {
  const q = async (s: string) => (await sql().query(s)) as Row[];
  const n = {
    pairs: await fill("pairs", await q(`select p.id, a.name || ' x ' || b.name base from pairs p join entities a on a.qloo_id = p.a_id join entities b on b.qloo_id = p.b_id where p.slug is null order by p.called_at`)),
    accounts: await fill("accounts", await q(`select ac.id, e.name base from accounts ac join entities e on e.qloo_id = ac.entity_id where ac.slug is null order by ac.created_at`)),
    plans: await fill("plans", await q(`select pl.id, e.name base from plans pl join accounts ac on ac.id = pl.account_id join entities e on e.qloo_id = ac.entity_id where pl.slug is null order by pl.created_at`)),
    contacts: await fill("contacts", await q(`select c.id, coalesce(c.name, e.name || ' ' || split_part(c.email, '@', 1) || ' inbox') base from contacts c join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id where c.slug is null order by c.created_at`)),
  };
  // Messages and replies hang off the contact's slug: /message/federico-foschini-1 is step 1 to Federico.
  const touches = await fill("touches", await q(`select t.id, coalesce(c.slug, c.id::text) || '-' || t.step base from touches t join contacts c on c.id = t.contact_id where t.slug is null order by t.created_at`));
  const replies = await fill("replies", await q(`select r.id, coalesce(c.slug, c.id::text) || '-reply' base from replies r join touches t on t.id = r.touch_id join contacts c on c.id = t.contact_id where r.slug is null order by r.created_at`));
  const missing = (await q(`select id, '' base from touches where optout_token is null`));
  for (const r of missing) await sql()`update touches set optout_token = ${token()} where id = ${r.id} and optout_token is null`;
  return { ...n, touches, replies, optout_tokens: missing.length };
}

/** Finds a row by slug or by its old UUID. `redirect` is set when the UUID was used, so the page can send people to the clean address. */
export async function resolve(table: string, key: string) {
  const k = decodeURIComponent(key);
  if (isUuid(k)) {
    const [r] = (await sql().query(`select id, slug from ${table} where id = $1`, [k])) as { id: string; slug: string | null }[];
    return r ? { id: r.id, redirect: r.slug ? pathFor(table, r.slug, r.id) : null } : null;
  }
  if (!/^[a-z0-9-]{1,80}$/.test(k)) return null;
  const [r] = (await sql().query(`select id from ${table} where slug = $1`, [k])) as { id: string }[];
  return r ? { id: r.id, redirect: null } : null;
}
