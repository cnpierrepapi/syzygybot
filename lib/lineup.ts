// Lineups: an award show's nominees, a festival bill, a venue's calendar. The lineup's audience is the sum of its
// members' audiences, so the brands to bring to it are the ones Qloo measured strongly against several members,
// both ways. Members Qloo hasn't measured for us can stand in through their look-alikes (lib/lookalike.ts).
import { loadCorpus } from "./corpus";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function composite(lineup: string[]) {
  const { profiles, edges } = await loadCorpus();
  const byName = new Map([...profiles.values()].map(p => [norm(p.name), p]));
  const members = lineup.map(n => ({ asked: n, p: byName.get(norm(n)) }));
  const found = members.filter(m => m.p).map(m => m.p!);
  const brands = new Map<string, { name: string; hits: { member: string; toward: number; back: number; band: string }[] }>();
  for (const m of found) for (const e of edges.get(m.id) ?? []) {
    const b = profiles.get(e.partnerId);
    if (!b || b.type !== "brand") continue;
    const x = brands.get(b.id) ?? { name: b.name, hits: [] };
    x.hits.push({ member: m.name, toward: e.toward, back: e.back, band: e.band });
    brands.set(b.id, x);
  }
  const ranked = [...brands].map(([id, x]) => ({
    id, name: x.name, reach: x.hits.length,
    mutual: x.hits.reduce((s, h) => s + Math.min(h.toward, h.back), 0) / x.hits.length, hits: x.hits,
  })).sort((a, b) => b.reach - a.reach || b.mutual - a.mutual);
  const cities = new Map<string, number>();
  for (const m of found) for (const c of m.metros.keys()) cities.set(c, (cities.get(c) ?? 0) + 1);
  return {
    measured: found.map(p => p.name),
    missing: members.filter(m => !m.p).map(m => m.asked),
    brands: ranked.slice(0, 20),
    sharedCities: [...cities].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ city: c, members: n })),
  };
}
