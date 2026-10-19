// Venue Desk (agent: Venue). The room's side of the market: for each Live Nation room, the brands whose audiences fill
// its city and that Qloo measured against the acts it books (sponsorship), pitched to the brand's sponsorship team.
import { sql } from "../db";
import { loadCorpus } from "../corpus";
import { metroMap, sideOf, syzygyMatch } from "../match";
import { makeRequest } from "./common";
import type { Persona } from "../personas";

type Fit = { venue_id: string; venue: string; metro: string; capacity_est: number; country: string; entity_id: string; entity_name: string; fit: number; evidence: { via?: string; brandFansTowardArtist?: number; artistFansTowardBrand?: number }; profile: { tags?: string[]; recentActs?: string[] } | null };

export async function runVenueDesk(p: Persona, n = 4) {
  const fits = (await sql()`
    select f.venue_id, v.name venue, v.metro, v.capacity_est, v.country, f.entity_id, f.entity_name, f.fit, f.evidence, v.profile
    from venue_fits f join venues v on v.id = f.venue_id
    where v.live_nation and f.role = 'sponsor' and v.profile is not null
    order by f.fit desc limit 60`) as Fit[];
  const { profiles } = await loadCorpus();
  const made: string[] = [], usedRooms = new Set<string>(), usedBrands = new Set<string>();
  for (const f of fits) {
    if (made.length >= n) break;
    if (usedRooms.has(f.venue_id) || usedBrands.has(f.entity_id)) continue;
    const brand = profiles.get(f.entity_id);
    if (!brand) continue;
    usedRooms.add(f.venue_id); usedBrands.add(f.entity_id);
    const m = await syzygyMatch({ name: f.venue, tags: new Set(f.profile?.tags ?? []), age: null, metros: metroMap([f.metro]) }, sideOf(brand));
    const [e] = (await sql()`select official_site from entities where qloo_id = ${f.entity_id}`) as { official_site: string | null }[];
    const facts = [
      `${f.venue} (${f.metro}, about ${f.capacity_est.toLocaleString("en-US")}) is a Live Nation room.`,
      ...(f.profile?.recentActs?.length ? [`Recent acts: ${f.profile.recentActs.slice(0, 4).join(", ")}.`] : []),
      `Our match score between the room's crowd and ${brand.name}'s audience: ${m.score} out of 100 (${m.strength}).`,
      ...(f.evidence?.via && f.evidence.artistFansTowardBrand != null ? [`Qloo's taste data: fans of ${f.evidence.via}, who concentrate in ${f.metro}, lean toward ${brand.name} at ${f.evidence.artistFansTowardBrand.toFixed(2)}, and ${brand.name}'s audience back at ${f.evidence.brandFansTowardArtist?.toFixed(2)} (0 to 1).`] : []),
    ];
    const id = await makeRequest({
      persona: p, desk: "venue", agent: "venue", action: "sponsor_pitch",
      title: `${brand.name} at ${f.venue}`, dedupe: `${p.id}|venue|${f.venue_id}|${f.entity_id}`,
      target: { org: brand.name, site: e?.official_site ?? null, country: "US", purpose: "sponsorship" },
      brief: { kind: `A venue sponsorship pitch to ${brand.name}: a season partnership at ${f.venue} (on-site activation, presale and naming of a bar or deck), because the room's crowd matches ${brand.name}'s audience. Ask for a call with their sponsorship lead.`, sender: p.title, facts },
      evidence: { match: m, facts }, targetBrand: brand.name, talent: f.evidence?.via ? [f.evidence.via] : [],
    });
    if (id) made.push(id);
  }
  return made;
}
