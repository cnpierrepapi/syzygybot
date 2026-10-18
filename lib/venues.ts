// Venues: concert rooms near each metro (Wikidata), scored on the Qloo corpus with no new Qloo calls.
// For each room: which measured artists' fans concentrate in its city and fit its size (book), and which brands
// those same fans pull toward, measured both ways by Qloo (sponsor). Same treatment as a brand account.
import { readFileSync } from "node:fs";
import { sql } from "./db";
import { slugify } from "./slug";
import { loadCorpus, type Profile } from "./corpus";

type RawVenue = { id: string; name: string; metro: string; capacity: number | null; operator: string | null; owner: string | null; site: string | null; kinds: string; coord?: string };

// Typical size when Wikidata has no capacity, by the kind of room.
const TYPICAL: [RegExp, number][] = [[/stadium/, 40000], [/arena/, 15000], [/amphitheat/, 12000], [/concert hall/, 2200], [/theatre/, 1200], [/music venue/, 900], [/nightclub/, 400]];
const LIVE_NATION = /live nation|house of blues|the fillmore|fillmore /i;

export async function importVenues(path: string) {
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawVenue[];
  const rooms = raw.filter(v => !/shopping center/.test(v.kinds) || /music venue|theatre|arena|concert hall|amphitheat|nightclub|stadium/.test(v.kinds.replace("shopping center", "")));
  const taken = new Set<string>();
  for (const v of rooms) {
    const kinds = v.kinds.toLowerCase();
    const est = v.capacity ?? TYPICAL.find(([re]) => re.test(kinds))?.[1] ?? 800;
    const [lng, lat] = (/Point\(([-\d.]+) ([-\d.]+)\)/.exec(v.coord ?? "") ?? []).slice(1).map(Number);
    let slug = slugify(v.name), n = 2;
    if (taken.has(slug)) slug = slugify(`${v.name} ${v.metro}`);
    while (taken.has(slug)) slug = slugify(`${v.name} ${v.metro} ${n++}`);
    taken.add(slug);
    await sql()`
      insert into venues (id, name, metro, capacity, capacity_est, kinds, operator, owner, site, lat, lng, live_nation, slug)
      values (${v.id}, ${v.name}, ${v.metro}, ${v.capacity}, ${est}, ${v.kinds}, ${v.operator}, ${v.owner}, ${v.site}, ${lat ?? null}, ${lng ?? null},
              ${LIVE_NATION.test(`${v.operator ?? ""} ${v.owner ?? ""} ${v.name}`)}, ${slug})
      on conflict (id) do update set name = excluded.name, metro = excluded.metro, capacity = excluded.capacity, capacity_est = excluded.capacity_est,
        kinds = excluded.kinds, operator = excluded.operator, owner = excluded.owner, site = excluded.site, live_nation = excluded.live_nation, updated_at = now()`;
  }
  return rooms.length;
}

/** The room size an act of this Qloo popularity usually plays, as [low, high] capacity. */
export function sizeBand(popularity: number | null): [number, number] {
  const p = popularity ?? 0.9;
  return p >= 0.995 ? [10000, 60000] : p >= 0.98 ? [2500, 12000] : p >= 0.93 ? [1000, 3500] : p >= 0.85 ? [400, 1500] : [100, 600];
}

/** 1 inside the band, falling off with how many times too big or too small the room is. */
export function sizeFit(capacity: number, popularity: number | null) {
  const [lo, hi] = sizeBand(popularity);
  if (capacity >= lo && capacity <= hi) return 1;
  const off = capacity < lo ? Math.log2(lo / capacity) : Math.log2(capacity / hi);
  return Math.max(0, 1 - off / 3);
}

export async function scoreVenues() {
  const { profiles, edges } = await loadCorpus();
  const artists = [...profiles.values()].filter(p => p.type === "artist" && p.metros.size);
  const brands = new Map([...profiles.values()].filter(p => p.type === "brand").map(p => [p.id, p]));
  const venues = (await sql()`select id, metro, capacity_est from venues`) as { id: string; metro: string; capacity_est: number }[];
  let fits = 0;
  for (const v of venues) {
    // Book: artists whose fans put this city in their top heatmap cells, weighted by rank, and who fit the room.
    const book = artists.map(a => {
      const w = a.metros.get(v.metro) ?? 0, s = sizeFit(v.capacity_est, a.popularity);
      return { a, w, s, fit: w ? 0.65 * w + 0.35 * s : 0 };
    }).filter(x => x.fit > 0 && x.s >= 0.34).sort((x, y) => y.fit - x.fit).slice(0, 8);
    // Sponsor: brands whose fans are also in this city and that Qloo measured against one of those artists, both ways.
    const sponsor = new Map<string, { b: Profile; fit: number; via: string; toward: number; back: number; w: number }>();
    for (const { a, fit } of book) for (const e of edges.get(a.id) ?? []) {
      const b = brands.get(e.partnerId);
      const wb = b?.metros.get(v.metro) ?? 0;
      if (!b || !wb) continue;
      const f = wb * Math.min(e.toward, e.back) * fit;
      if (f > (sponsor.get(b.id)?.fit ?? 0)) sponsor.set(b.id, { b, fit: f, via: a.name, toward: e.back, back: e.toward, w: wb });
    }
    const sp = [...sponsor.values()].sort((x, y) => y.fit - x.fit).slice(0, 8);
    const rows = [
      ...book.map(x => ({ entity_id: x.a.id, entity_name: x.a.name, entity_type: "artist", role: "book", fit: x.fit,
        evidence: { cityWeight: +x.w.toFixed(2), sizeFit: +x.s.toFixed(2), popularity: x.a.popularity, band: sizeBand(x.a.popularity) } })),
      ...sp.map(x => ({ entity_id: x.b.id, entity_name: x.b.name, entity_type: "brand", role: "sponsor", fit: x.fit,
        evidence: { via: x.via, brandFansTowardArtist: +x.toward.toFixed(3), artistFansTowardBrand: +x.back.toFixed(3), cityWeight: +x.w.toFixed(2) } })),
    ];
    const top = (xs: { fit: number }[]) => (xs.length ? xs.slice(0, 3).reduce((s, x) => s + x.fit, 0) / 3 : 0);
    const score = (top(book) + top(sp)) / 2;
    // One round trip per venue: replace its fits and set its score.
    await sql()`
      with gone as (delete from venue_fits where venue_id = ${v.id}),
      added as (
        insert into venue_fits (venue_id, entity_id, entity_name, entity_type, role, fit, evidence)
        select ${v.id}, x.entity_id, x.entity_name, x.entity_type, x.role, x.fit, x.evidence
        from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(entity_id text, entity_name text, entity_type text, role text, fit double precision, evidence jsonb))
      update venues set score = ${score}, evidence = ${JSON.stringify({ bookable: book.length, sponsors: sp.length })}, updated_at = now() where id = ${v.id}`;
    fits += book.length + sp.length;
  }
  return { venues: venues.length, fits };
}
