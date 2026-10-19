// Tour & Venues desk (agent: Router). Artist → the cities where its fans concentrate (Qloo heatmaps) → the rooms in each city
// that fit the draw and book similar acts → a hold request to each room's published booking address.
import { planTour } from "../tour";
import { loadCorpus } from "../corpus";
import { sql } from "../db";
import { metroMap, sideOf, syzygyMatch } from "../match";
import { makeRequest } from "./common";
import type { Persona } from "../personas";

export async function runTour(p: Persona, artist: string, opts: { stops?: number; liveNationOnly?: boolean } = {}) {
  const plan = await planTour(artist, { roomSize: p.roomSize, cities: 12, roomsPerCity: 6, liveNationOnly: opts.liveNationOnly });
  if (!plan) return [];
  const { profiles } = await loadCorpus();
  const a = [...profiles.values()].find(x => x.name === plan.artist)!;
  const rooms = (await sql()`select id, name, site, country, capacity_est, live_nation, profile from venues where id = any(${plan.stops.flatMap(s => s.rooms.map(r => r.id))})`) as
    { id: string; name: string; site: string | null; country: string; capacity_est: number; live_nation: boolean; profile: { tags?: string[]; recentActs?: string[]; summary?: string } | null }[];
  const made: string[] = [];
  const stops = plan.stops.filter(s => s.rooms.length).slice(0, opts.stops ?? 4);
  for (const [i, s] of stops.entries()) {
    const pick = s.rooms.find(r => !r.needsRead) ?? s.rooms[0];
    if (!pick) continue;
    const room = rooms.find(r => r.id === pick.id)!;
    const m = room.profile?.tags?.length
      ? await syzygyMatch(sideOf(a), { name: room.name, tags: new Set(room.profile.tags), age: null, metros: metroMap([s.metro]) })
      : null;
    const facts = [
      `Stop ${i + 1} of the route: ${s.metro}. ${i === 0 ? "This is where the artist's fans concentrate most in Qloo's US heatmap." : `Fan concentration ${s.fanWeight} of the top city (Qloo heatmap).`}`,
      `${room.name} holds about ${room.capacity_est.toLocaleString("en-US")}.`,
      ...(room.profile?.recentActs?.length ? [`Recent acts there: ${room.profile.recentActs.slice(0, 4).join(", ")}.`] : []),
      ...(m ? [`Our match score between the artist's audience and what the room books: ${m.score} out of 100 (${m.strength}).`] : []),
    ];
    const id = await makeRequest({
      persona: p, desk: "tour", agent: "router", action: "hold_request",
      title: `Hold ${room.name} for ${plan.artist}`,
      dedupe: `${p.id}|tour|${room.id}`,
      target: { org: room.name, site: room.site, country: room.country, purpose: "booking" },
      brief: {
        kind: "A hold request: ask the venue's booking team which dates they could hold for a stadium or arena show in the next touring window, and who to send the offer to.",
        sender: p.title, facts,
      },
      evidence: { match: m, facts },
      talent: [plan.artist],
    });
    if (id) made.push(id);
  }
  return made;
}
