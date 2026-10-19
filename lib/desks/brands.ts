// Brand-side desks. Sponsorship (agent: Sponsor) pitches brands on an event, a lineup or a tour leg; Talent (agent: Talent)
// pitches a longer ambassador deal. Both rank brands by OUR match score; Qloo's measurement rides along where it exists.
import { loadCorpus, type Profile } from "../corpus";
import { composite } from "../lineup";
import { sql } from "../db";
import { match as lookalikeMatch } from "../lookalike";
import { sideOf, syzygyMatch, tagLabel, type Match } from "../match";
import { makeRequest, talentDeals } from "./common";
import type { Persona } from "../personas";

type Candidate = { brand: Profile; m: Match };

async function profileByName(name: string) {
  const { profiles } = await loadCorpus();
  const n = name.toLowerCase();
  return [...profiles.values()].find(p => p.name.toLowerCase() === n) ?? null;
}

/** Brands for a talent: every brand Qloo measured against it, plus brands its look-alikes were measured against, ranked by our score. */
export async function brandsFor(talent: Profile, take = 12): Promise<Candidate[]> {
  const { profiles, edges } = await loadCorpus();
  const ids = new Set((edges.get(talent.id) ?? []).map(e => e.partnerId));
  const viaLookalikes = await lookalikeMatch([...talent.tags], "talent");
  for (const x of viaLookalikes.partners) ids.add(x.id);
  const out: Candidate[] = [];
  for (const id of ids) {
    const b = profiles.get(id);
    if (!b || b.type !== "brand") continue;
    out.push({ brand: b, m: await syzygyMatch(sideOf(talent), sideOf(b)) });
  }
  return out.sort((x, y) => y.m.score - x.m.score).slice(0, take);
}

const evidenceFacts = (subject: string, b: string, m: Match) => [
  `Our match score between ${subject}'s audience and ${b}'s: ${m.score} out of 100 (${m.strength}).`,
  ...(m.qloo ? [`Qloo's taste data confirms it: ${subject}'s audience leans toward ${b} at ${m.qloo.toward.toFixed(2)}, and ${b}'s audience back at ${m.qloo.back.toFixed(2)} (0 to 1).`] : ["Qloo hasn't measured this pair yet; the score is SYZYGY's own estimate."]),
  ...(m.sharedTags.length ? [`Shared audience tastes: ${m.sharedTags.slice(0, 4).map(tagLabel).join(", ")}.`] : []),
  ...(m.sharedCities.length ? [`Both audiences concentrate in ${m.sharedCities.slice(0, 3).join(", ")}.`] : []),
];

async function site(b: Profile) {
  const [e] = (await sql()`select official_site from entities where qloo_id = ${b.id}`) as { official_site: string | null }[];
  return e?.official_site ?? null;
}

/** Tour or event sponsorship for a talent's audience: one pitch per brand. */
export async function runSponsorForTalent(p: Persona, talentName: string, n = 3, skip: string[] = []) {
  const t = await profileByName(talentName);
  if (!t) return [];
  const deals = await talentDeals(talentName);
  const made: string[] = [];
  for (const { brand, m } of (await brandsFor(t)).filter(c => !skip.includes(c.brand.name)).slice(0, n)) {
    const facts = evidenceFacts(talentName, brand.name, m);
    const id = await makeRequest({
      persona: p, desk: "sponsorship", agent: "sponsor", action: "sponsor_pitch",
      title: `${brand.name} as a ${talentName} tour sponsor`,
      dedupe: `${p.id}|sponsorship|${brand.id}`,
      target: { org: brand.name, site: await site(brand), country: "US", purpose: "sponsorship" },
      brief: { kind: `A sponsorship pitch: offer ${brand.name} a presenting partnership on ${talentName}'s next tour leg, led by the cities where both audiences concentrate. Ask for 20 minutes with their sponsorship lead.`, sender: p.title, facts },
      evidence: { match: m, facts }, talent: [talentName], targetBrand: brand.name, talentDeals: deals,
    });
    if (id) made.push(id);
  }
  return made;
}

/** Ambassador deals for a talent, skipping brands the sponsorship desk already has. */
export async function runAmbassador(p: Persona, talentName: string, n = 3, skip: string[] = []) {
  const t = await profileByName(talentName);
  if (!t) return [];
  const deals = await talentDeals(talentName);
  const made: string[] = [];
  const taken = new Set(((await sql()`select target->>'org' org from permission_requests where persona = ${p.id}`) as { org: string }[]).map(r => r.org));
  for (const { brand, m } of (await brandsFor(t, 20)).filter(c => !taken.has(c.brand.name) && !skip.includes(c.brand.name)).slice(0, n)) {
    const facts = evidenceFacts(talentName, brand.name, m);
    const id = await makeRequest({
      persona: p, desk: "talent", agent: "talent", action: "ambassador_pitch",
      title: `${talentName} × ${brand.name}: ambassador deal`,
      dedupe: `${p.id}|talent|${brand.id}`,
      target: { org: brand.name, site: await site(brand), country: "US", purpose: "partnerships" },
      brief: { kind: `An ambassador pitch to ${brand.name}'s partnerships team: a 12-month ${talentName} ambassador deal, built on how the two audiences overlap. Ask who runs talent partnerships.`, sender: p.title, facts },
      evidence: { match: m, facts }, talent: [talentName], targetBrand: brand.name, talentDeals: deals,
    });
    if (id) made.push(id);
  }
  return made;
}

/** A lineup (award show nominees, a festival bill): its composite audience → sponsors measured against several members. */
export async function runLineupSponsors(p: Persona, n = 4) {
  if (!p.lineup) return [];
  const c = await composite(p.lineup.members);
  const made: string[] = [];
  const { profiles } = await loadCorpus();
  for (const b of c.brands.slice(0, n)) {
    const brand = profiles.get(b.id)!;
    const best = b.hits.sort((x, y) => Math.min(y.toward, y.back) - Math.min(x.toward, x.back))[0];
    const member = profiles.get([...profiles.values()].find(x => x.name === best.member)!.id)!;
    const m = await syzygyMatch(sideOf(member), sideOf(brand));
    const facts = [
      `${p.lineup.name}: Qloo has measured ${c.measured.length} of ${p.lineup.members.length} nominees so far (${c.measured.join(", ")}).`,
      `${brand.name} reaches ${b.reach} of them. ${b.hits.map(h => `${h.member}'s audience leans toward ${brand.name} at ${h.toward.toFixed(2)}, and back at ${h.back.toFixed(2)}`).join("; ")} (Qloo's taste data, 0 to 1).`,
      `Our match score with ${best.member}'s audience: ${m.score} out of 100 (${m.strength}).`,
      ...(c.sharedCities.length ? [`The nominees' audiences overlap in ${c.sharedCities.slice(0, 3).map(x => x.city).join(", ")}.`] : []),
    ];
    const id = await makeRequest({
      persona: p, desk: "sponsorship", agent: "sponsor", action: "sponsor_pitch",
      title: `${brand.name} for the ${p.subject} broadcast`,
      dedupe: `${p.id}|sponsorship|${brand.id}`,
      target: { org: brand.name, site: await site(brand), country: "US", purpose: "sponsorship" },
      brief: { kind: `A sponsorship pitch to ${brand.name}: a broadcast or category partnership on the ${p.subject}, because the nominees' audiences already lean toward ${brand.name}. Ask for a call with their sponsorship lead.`, sender: p.title, facts },
      evidence: { match: m, facts }, talent: c.measured, targetBrand: brand.name,
    });
    if (id) made.push(id);
  }
  return made;
}
