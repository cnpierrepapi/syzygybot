// Rival check (24 Oct): before a desk pitches a brand, it looks up who the desk's subject already works with (a talent's
// brand deals, a venue's or a show's sponsors) and, on the web, who competes with each of those partners. A brand that
// competes with a current partner is skipped before it becomes a card: the owner would never agree to send that pitch.
// Clearance's exclusivity rule stays as the backstop on whatever gets through.
import { sql } from "./db";
import { askWeb, parseJson } from "./llm";
import { talentDeals } from "./desks/common";
import type { Deal } from "./clearance";

export type Rival = { rival: string; partner: string; category: string; source: string | null };
export type Screen = Map<string, Rival>;

const RIVALS_DAYS = 30;
const MAX_PARTNERS = 8;

/** Lowercase, punctuation out, company suffixes off: "Levi Strauss & Co." and "Levi's" meet as "levi...". */
export const normName = (s: string) => s.toLowerCase().replace(/['’]s\b/g, "").replace(/&\s*co\b\.?/g, " ").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|co|corp|corporation|company|llc|ltd|plc|group|brand|brands|product line)\b/g, " ")
  .replace(/\s+/g, " ").trim();

/** Sponsors and brand partners of a venue, show, podcast or company (talent use their brand deals), read from the web. */
async function sponsorsOf(name: string): Promise<Deal[]> {
  const [hit] = (await sql()`select deals from talent_deals where talent = ${name} and checked_at > now() - interval '14 days'`) as { deals: Deal[] }[];
  if (hit) return hit.deals;
  const r = await askWeb(`List the current sponsors, official partners and brand deals of "${name}" from the last three years: brand, product
category (e.g. beer, soft drinks, credit cards, sportswear), whether it is reported as exclusive or official, the year, and a source URL.
JSON only: {"deals": [{"brand": "", "category": "", "exclusive": true|false, "year": 2025, "source": ""}]}`,
    "You research sponsorship and brand partnerships from reputable press and the organisation's own pages. Reply with JSON only. Leave out anything you can't source.", 900);
  const deals = (parseJson<{ deals: Deal[] }>(r.text)?.deals ?? []).filter(d => d.brand && d.category);
  await sql()`insert into talent_deals (talent, deals, sources) values (${name}, ${JSON.stringify(deals)}, ${JSON.stringify(r.sources.slice(0, 8))})
    on conflict (talent) do update set deals = excluded.deals, sources = excluded.sources, checked_at = now()`;
  return deals;
}

/** A partner's direct competitors in its category, from the web, kept for a month (shared by every desk). */
export async function rivalsOf(brand: string, category: string): Promise<{ name: string; source: string | null }[]> {
  const key = normName(brand);
  const [hit] = (await sql()`select rivals from brand_rivals where brand = ${key} and checked_at > now() - make_interval(days => ${RIVALS_DAYS})`) as { rivals: { name: string; source: string | null }[] }[];
  if (hit) return hit.rivals;
  const r = await askWeb(`Who are the direct competitors of ${brand} in ${category}? List the companies, and their own brands and product lines,
that a partner of ${brand} would normally be barred from under a category exclusivity clause. Include sub-brands that compete on
their own (for Adidas that means Nike, Air Jordan, Converse, Puma, Reebok, Under Armour, New Balance and so on). Leave out
companies that only overlap a little, and leave out ${brand}'s own brands.
One brand per entry, written the way the public knows it ("Ralph Lauren", "Air Jordan"), with no parent company in brackets and no
"and" joining two brands. Give each rival's own competing sub-brands as separate entries.
JSON only: {"rivals": [{"name": "", "source": ""}]}`,
    "You research competitive landscapes from reputable business press. Reply with JSON only. Name only real, current brands.", 900);
  const own = normName(brand);
  // Models still bundle now and then ("BOSS and HUGO (Hugo Boss AG)"): brackets go, and a bundle splits into its brands.
  const rivals = (parseJson<{ rivals: { name: string; source?: string }[] }>(r.text)?.rivals ?? [])
    .flatMap(x => (x.name ?? "").replace(/\([^)]*\)/g, " ").split(/,| and /).map(name => ({ name: name.replace(/\s+/g, " ").trim(), source: x.source?.trim() || r.sources[0]?.url || null })))
    .filter(x => normName(x.name).length >= 2 && normName(x.name) !== own);
  await sql()`insert into brand_rivals (brand, category, rivals, sources) values (${key}, ${category}, ${JSON.stringify(rivals)}, ${JSON.stringify(r.sources.slice(0, 8))})
    on conflict (brand) do update set category = excluded.category, rivals = excluded.rivals, sources = excluded.sources, checked_at = now()`;
  return rivals;
}

/** Everyone who competes with one of this subject's current partners. `talent` subjects use their brand-deal record. */
export async function screenFor(subject: string, talent: boolean): Promise<{ partners: Deal[]; screen: Screen }> {
  // The same deals Clearance checks (the lookups only cover recent years), exclusive ones first.
  const all = talent ? await talentDeals(subject) : await sponsorsOf(subject);
  const partners = [...all].sort((a, b) => +b.exclusive - +a.exclusive || (b.year ?? 0) - (a.year ?? 0)).slice(0, MAX_PARTNERS);
  const screen: Screen = new Map();
  const lists = await Promise.all(partners.map(p => rivalsOf(p.brand, p.category).catch(() => [])));
  partners.forEach((p, i) => {
    for (const r of lists[i]) {
      const k = normName(r.name);
      if (k.length >= 3 && !screen.has(k)) screen.set(k, { rival: r.name, partner: p.brand, category: p.category, source: r.source });
    }
  });
  // A current partner is never its own rival's rival: drop partners that showed up in another partner's list.
  for (const p of partners) screen.delete(normName(p.brand));
  return { partners, screen };
}

/** The partner this brand competes with, if any. "Nike Training Club" meets "Nike"; "Air Jordan Product Line" meets "Air Jordan". */
export function rivalHit(name: string, screen: Screen): Rival | null {
  const n = normName(name);
  if (!n) return null;
  const exact = screen.get(n);
  if (exact) return exact;
  for (const [k, v] of screen) if (k.length >= 4 && (n.startsWith(`${k} `) || k.startsWith(`${n} `) && n.length >= 4)) return v;
  return null;
}
