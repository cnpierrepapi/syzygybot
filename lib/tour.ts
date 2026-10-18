// Tour planning: artist -> cities -> rooms. Cities come from the artist's Qloo heatmap (where its fans concentrate);
// rooms are ranked by how well what they book matches the artist's taste profile, then by size fit. Rooms with no web
// read yet are ranked on size and kind only and flagged, so the planner can profile the shortlist on demand.
import { sql } from "./db";
import { loadCorpus, tagFrequencies, tagSimilarity } from "./corpus";
import { sizeBand, sizeFit } from "./venues";

type Room = { id: string; name: string; slug: string | null; metro: string; capacity_est: number; live_nation: boolean; kinds: string; profile: { tags?: string[]; recentActs?: string[]; summary?: string } | null };

// Rooms Wikidata files only as a sports ground: plenty are concert stages, plenty are campus fields. Unread, they rank below real stages.
const STAGE_KIND = /music venue|concert hall|amphitheat|theatre|nightclub/i;
const inactive = (r: Room) => !!r.profile?.summary && !(r.profile.recentActs ?? []).length;

export async function planTour(artistName: string, opts: { cities?: number; roomsPerCity?: number } = {}) {
  const { profiles } = await loadCorpus();
  const artist = [...profiles.values()].find(p => p.name.toLowerCase() === artistName.toLowerCase() && (p.type === "artist" || p.type === "tv_show"));
  if (!artist) return null;
  const df = tagFrequencies(profiles), n = profiles.size;
  const cities = [...artist.metros].sort((a, b) => b[1] - a[1]).slice(0, opts.cities ?? 8);
  const rooms = (await sql()`select id, name, slug, metro, capacity_est, live_nation, kinds, profile from venues
    where metro = any(${cities.map(([m]) => m)})`) as Room[];
  const [lo, hi] = sizeBand(artist.popularity);
  return {
    artist: artist.name, popularity: artist.popularity, roomSize: [lo, hi],
    stops: cities.map(([metro, w]) => ({
      metro, fanWeight: +w.toFixed(2),
      rooms: rooms.filter(r => r.metro === metro && !inactive(r)).map(r => {
        const s = sizeFit(r.capacity_est, artist.popularity);
        const t = r.profile?.tags?.length ? tagSimilarity(new Set(r.profile.tags), artist.tags, df, n) : null;
        return {
          id: r.id, name: r.name, slug: r.slug, capacity: r.capacity_est, liveNation: r.live_nation, sizeFit: +s.toFixed(2),
          tasteMatch: t == null ? null : +t.toFixed(3), recentActs: r.profile?.recentActs?.slice(0, 5) ?? [],
          // Profiled rooms rank on taste first; the rest on size, and say they still need a read.
          rank: t == null ? (STAGE_KIND.test(r.kinds) ? 0.6 : 0.3) * s : 0.6 * Math.min(1, t / 0.25) + 0.4 * s, needsRead: t == null,
        };
      }).filter(x => x.sizeFit >= 0.67).sort((a, b) => b.rank - a.rank).slice(0, opts.roomsPerCity ?? 4),
    })),
  };
}
