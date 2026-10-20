// Desks for subjects Qloo hasn't measured (Cedric and his brands, This Week in Startups). The subject gets a look-alike
// profile built from the web in Qloo's tag vocabulary (lib/lookalike.ts), and every brand in the corpus is ranked by OUR
// match score against it. No Qloo number exists for these pairs, so every card says the score is SYZYGY's own estimate.
import { sql } from "../db";
import { loadCorpus, type Profile } from "../corpus";
import { synthesize, lookalike } from "../lookalike";
import { metroMap, sideOf, syzygyMatch, tagLabel, type Match, type Side } from "../match";
import { makeRequest, talentDeals, type Purpose } from "./common";
import type { DeskId, Persona } from "../personas";

type Synthetic = { name: string; kind: string; tags: string[]; age: Record<string, number> | null; metros: string[]; summary: string; lookalikes: { strength?: string; nearest?: { name: string; similarity: number }[] } };

/** The stored look-alike profile, or a new one (one web read, about $0.03). */
export async function synthetic(name: string, description: string, kind: "brand" | "talent"): Promise<Synthetic> {
  const [hit] = (await sql()`select name, kind, tags, age, metros, summary, lookalikes from synthetic_profiles where name = ${name}`) as Synthetic[];
  if (hit) return hit;
  await lookalike(name, description, kind, await synthesize(name, description));
  return ((await sql()`select name, kind, tags, age, metros, summary, lookalikes from synthetic_profiles where name = ${name}`) as Synthetic[])[0];
}

export const sideOfSynthetic = (s: Synthetic): Side => ({ name: s.name, tags: new Set(s.tags), age: s.age, metros: metroMap(s.metros) });

export async function rankBrands(side: Side, take = 10, exclude: string[] = []) {
  const { profiles } = await loadCorpus();
  const out: { brand: Profile; m: Match }[] = [];
  for (const b of profiles.values()) {
    if (b.type !== "brand" || !b.tags.size || exclude.includes(b.name)) continue;
    out.push({ brand: b, m: await syzygyMatch(side, sideOf(b)) });
  }
  return out.sort((x, y) => y.m.score - x.m.score).slice(0, take);
}

const DESCRIPTIONS: Record<string, string> = {
  "Cedric the Entertainer": "comedian, actor and host; The Neighborhood, Barbershop, The Original Kings of Comedy",
  "AC Barbeque": "barbecue sauce, rubs and restaurant brand co-founded by Cedric the Entertainer and Anthony Anderson",
  "This Week in Startups": "Jason Calacanis's weekly podcast for founders, angel investors and startup operators",
};

const KIND: Record<string, { action: "ambassador_pitch" | "sponsor_pitch" | "podcast_pitch"; agent: "talent" | "sponsor" | "podcast"; ask: (s: string, b: string) => string; title: (s: string, b: string) => string; purpose: Purpose }> = {
  talent: { action: "ambassador_pitch", agent: "talent", purpose: "partnerships", title: (s, b) => `${s} × ${b}: ambassador deal`,
    ask: (s, b) => `An ambassador pitch to ${b}: a campaign with ${s}, built on how close ${b}'s audience is to the people who follow ${s}. Ask who runs talent partnerships.` },
  sales: { action: "sponsor_pitch", agent: "sponsor", purpose: "partnerships", title: (s, b) => `${s} × ${b}: co-branded drop`,
    ask: (s, b) => `A co-branding pitch from ${s} to ${b}: a limited co-branded product or a joint promotion, because their audiences look alike. Ask them to reply if they want the full numbers.` },
  podcast: { action: "podcast_pitch", agent: "podcast", purpose: "advertising", title: (s, b) => `${b} sponsoring ${s}`,
    ask: (s, b) => `An ad-sales pitch to ${b}: a host-read sponsorship package on ${s}, because the show's listeners look like ${b}'s customers. Ask who buys podcast or creator media.` },
};

export async function runPatternTalent(p: Persona, subject: string, n = 3, desk: DeskId = "talent") {
  const kindOfSubject = subject === "Cedric the Entertainer" || subject === "This Week in Startups" ? "talent" : "brand";
  const s = await synthetic(subject, DESCRIPTIONS[subject] ?? subject, kindOfSubject);
  if (!s?.tags?.length) return [];
  const k = KIND[desk] ?? KIND.talent;
  const deals = kindOfSubject === "talent" && desk === "talent" ? await talentDeals(subject) : [];
  const taken = new Set(((await sql()`select target->>'org' org from permission_requests where persona = ${p.id}`) as { org: string }[]).map(r => r.org));
  const made: string[] = [];
  const nearest = (s.lookalikes?.nearest ?? []).slice(0, 3).map(x => x.name);
  for (const { brand, m } of (await rankBrands(sideOfSynthetic(s), 25, p.brands ?? [])).filter(c => !taken.has(c.brand.name)).slice(0, n)) {
    const facts = [
      `Our match score between ${subject}'s audience and ${brand.name}'s: ${m.score} out of 100 (${m.strength}). It's SYZYGY's own estimate.`,
      `${subject}'s profile was built from public sources in Qloo's tag vocabulary${nearest.length ? `; its nearest measured look-alikes are ${nearest.join(", ")}` : ""}.`,
      ...(m.sharedTags.length ? [`Shared audience tastes: ${m.sharedTags.slice(0, 4).map(tagLabel).join(", ")}.`] : []),
      ...(m.sharedCities.length ? [`Both audiences concentrate in ${m.sharedCities.slice(0, 3).join(", ")}.`] : []),
    ];
    const [e] = (await sql()`select official_site from entities where qloo_id = ${brand.id}`) as { official_site: string | null }[];
    const id = await makeRequest({
      persona: p, desk, agent: k.agent, action: k.action,
      title: k.title(subject, brand.name), dedupe: `${p.id}|${desk}|${subject}|${brand.id}`,
      target: { org: brand.name, site: e?.official_site ?? null, country: "US", purpose: k.purpose },
      brief: { kind: k.ask(subject, brand.name), sender: p.title, facts },
      evidence: { match: m, pattern: { pct: m.score, strength: s.lookalikes?.strength ?? m.strength, lookalikes: nearest }, facts },
      talent: kindOfSubject === "talent" ? [subject] : [], targetBrand: brand.name, talentDeals: deals,
    });
    if (id) made.push(id);
  }
  return made;
}
