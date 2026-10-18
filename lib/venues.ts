// Venues: concert rooms near each metro (Wikidata), scored on the Qloo corpus with no new Qloo calls.
// For each room: which measured artists' fans concentrate in its city and fit its size (book), and which brands
// those same fans pull toward, measured both ways by Qloo (sponsor). Same treatment as a brand account.
import { readFileSync } from "node:fs";
import { sql } from "./db";
import { slugify } from "./slug";
import { loadCorpus, tagFrequencies, tagSimilarity, type Profile } from "./corpus";
import { askWeb, parseJson } from "./llm";

type RawVenue = { id: string; name: string; metro: string; capacity: number | null; operator: string | null; owner: string | null; site: string | null; kinds: string; coord?: string };

// Typical size when Wikidata has no capacity, by the kind of room.
const TYPICAL: [RegExp, number][] = [[/stadium/, 40000], [/arena/, 15000], [/amphitheat/, 12000], [/concert hall/, 2200], [/theatre/, 1200], [/music venue/, 900], [/nightclub/, 400]];
const LIVE_NATION = /live nation|house of blues|the fillmore|fillmore /i;

export async function importVenues(path: string) {
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawVenue[];
  // Rooms that put on shows. Dropped: shopping centres, and school or college sports facilities unless they are
  // also a concert hall or music venue (Royce Hall stays, a campus track stadium goes).
  const musicKind = /music venue|concert hall|amphitheat/i;
  const campus = /high school|college|university|\bucla\b|\busc\b|cal state|school|academy|track and field|field house|fieldhouse|gymnasium|natatorium|softball|conference center|convention center|church|cathedral/i;
  const rooms = raw
    .filter(v => !/shopping center/.test(v.kinds) || /music venue|theatre|arena|concert hall|amphitheat|nightclub|stadium/.test(v.kinds.replace("shopping center", "")))
    .filter(v => musicKind.test(v.kinds) || !campus.test(`${v.name} ${v.operator ?? ""} ${v.owner ?? ""}`));
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

const PROFILE_SYSTEM = `You profile live-music rooms for a booking desk. Research the venue on the web: who it has actually booked
in the last three years (headliners, residencies, festivals), the genres and scenes it is known for, and who its crowd is.
Then pick 25 to 40 tags ONLY from the provided vocabulary that describe the acts it books and their audiences' tastes.
Also give its usual concert capacity as a number (null if it does not host concerts).
Reply with JSON only: {"tags": [...], "recentActs": ["artist", ...], "genres": ["..."], "capacity": 0, "summary": "one sentence", "confidence": "high|medium|low"}`;

/** What a room books, in Qloo's vocabulary, so it can be matched to artists by taste and not just by city and size. */
export async function profileVenue(id: string) {
  const [v] = (await sql()`select id, name, metro, capacity_est, site from venues where id = ${id}`) as { id: string; name: string; metro: string; capacity_est: number; site: string | null }[];
  const { profiles } = await loadCorpus();
  const vocab = [...tagFrequencies(profiles)].sort((a, b) => b[1] - a[1]).slice(0, 1500).map(([t]) => t);
  const r = await askWeb(`Venue: ${v.name}, ${v.metro} (about ${v.capacity_est} capacity${v.site ? `, ${v.site}` : ""})\n\nVocabulary (choose only from these):\n${vocab.join(", ")}`, PROFILE_SYSTEM, 1200);
  const j = parseJson<{ tags?: string[]; recentActs?: string[]; genres?: string[]; capacity?: number | null; summary?: string; confidence?: string }>(r.text);
  const allowed = new Set(vocab);
  const profile = {
    tags: (j?.tags ?? []).filter(t => allowed.has(t)), recentActs: (j?.recentActs ?? []).slice(0, 20), genres: j?.genres ?? [],
    summary: j?.summary ?? "", confidence: j?.confidence ?? "low", sources: r.sources.slice(0, 8), costUsd: r.costUsd,
  };
  const cap = typeof j?.capacity === "number" && j.capacity >= 50 && j.capacity <= 120000 ? Math.round(j.capacity) : null;
  await sql()`update venues set profile = ${JSON.stringify({ ...profile, capacity: cap })}, capacity_est = coalesce(${cap}, capacity_est) where id = ${id}`;
  return profile;
}

/** The rooms worth a web read: every Live Nation-run room, then the best-scored rooms in each city. */
export async function venuesToProfile(perMetro = 3) {
  return (await sql()`
    select id from (select id, live_nation, row_number() over (partition by metro order by score desc nulls last) rk from venues where profile is null and score > 0) t
    where live_nation or rk <= ${perMetro}`) as { id: string }[];
}

// Below this, an artist's Qloo tags and what the room books barely overlap: better "no match yet" than a forced name.
const TASTE_FLOOR = 0.08;

export async function scoreVenues() {
  const { profiles, edges } = await loadCorpus();
  const artists = [...profiles.values()].filter(p => p.type === "artist" && p.metros.size);
  const brands = new Map([...profiles.values()].filter(p => p.type === "brand").map(p => [p.id, p]));
  const venues = (await sql()`select id, metro, capacity_est, profile from venues`) as { id: string; metro: string; capacity_est: number; profile: { tags: string[]; recentActs?: string[]; summary?: string } | null }[];
  const df = tagFrequencies(profiles), n = profiles.size;
  let fits = 0;
  // Eight rooms at a time: each is one database round trip, and there are well over a thousand.
  const one = async (v: (typeof venues)[number]) => {
    // Book: artists whose fans put this city in their top heatmap cells, weighted by rank, and who fit the room.
    // With a room profile, taste leads: what the room books against the artist's Qloo tags. Without one, city and size only.
    // A web read that describes the room but finds no recent acts: a historic building or a sports field. Not a stage.
    if (v.profile && v.profile.summary && !(v.profile.recentActs ?? []).length) {
      await sql()`with gone as (delete from venue_fits where venue_id = ${v.id})
        update venues set score = null, evidence = ${JSON.stringify({ basis: "not an active stage (no recent acts found)" })} where id = ${v.id}`;
      return;
    }
    const roomTags = v.profile?.tags?.length ? new Set(v.profile.tags) : null;
    const book = artists.map(a => {
      const w = a.metros.get(v.metro) ?? 0, s = sizeFit(v.capacity_est, a.popularity);
      const t = roomTags ? tagSimilarity(roomTags, a.tags, df, n) : null;
      const fit = !w ? 0 : t == null ? 0.65 * w + 0.35 * s : 0.5 * Math.min(1, t / 0.3) + 0.3 * w + 0.2 * s;
      return { a, w, s, t, fit };
    }).filter(x => x.fit > 0 && x.s >= 0.67 && (x.t == null || x.t >= TASTE_FLOOR)).sort((x, y) => y.fit - x.fit).slice(0, 8); // within 2x of the act's usual room; a profiled room needs a real taste match
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
        evidence: { cityWeight: +x.w.toFixed(2), sizeFit: +x.s.toFixed(2), tasteMatch: x.t == null ? null : +x.t.toFixed(3), popularity: x.a.popularity, band: sizeBand(x.a.popularity) } })),
      ...sp.map(x => ({ entity_id: x.b.id, entity_name: x.b.name, entity_type: "brand", role: "sponsor", fit: x.fit,
        evidence: { via: x.via, brandFansTowardArtist: +x.toward.toFixed(3), artistFansTowardBrand: +x.back.toFixed(3), cityWeight: +x.w.toFixed(2) } })),
    ];
    const top = (xs: { fit: number }[]) => (xs.length ? xs.slice(0, 3).reduce((s, x) => s + x.fit, 0) / 3 : 0);
    const score = (top(book) + top(sp)) / 2;
    // One round trip per venue: replace its fits and set its score.
    // All parts of one statement see the same snapshot, so old fits are updated in place and only stale ones deleted.
    const recs = JSON.stringify(rows);
    await sql()`
      with fresh as (select * from jsonb_to_recordset(${recs}::jsonb) as x(entity_id text, entity_name text, entity_type text, role text, fit double precision, evidence jsonb)),
      gone as (delete from venue_fits f where f.venue_id = ${v.id} and not exists (select 1 from fresh x where x.entity_id = f.entity_id and x.role = f.role)),
      added as (
        insert into venue_fits (venue_id, entity_id, entity_name, entity_type, role, fit, evidence)
        select ${v.id}, x.entity_id, x.entity_name, x.entity_type, x.role, x.fit, x.evidence from fresh x
        on conflict (venue_id, entity_id, role) do update set fit = excluded.fit, evidence = excluded.evidence, entity_name = excluded.entity_name)
      update venues set score = ${score}, evidence = ${JSON.stringify({ bookable: book.length, sponsors: sp.length, basis: roomTags ? "taste + city + size" : "city + size only" })}, updated_at = now() where id = ${v.id}`;
    fits += book.length + sp.length;
  };
  for (let i = 0; i < venues.length; i += 8) await Promise.all(venues.slice(i, i + 8).map(one));
  return { venues: venues.length, fits };
}
