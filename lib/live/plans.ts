// What each persona's agents work on in a live run: whose audience they read in Qloo, what they pitch off it, and how many
// cards each lane makes. Everything here is a connection of the persona's own brands, shows, rooms or talent; nothing comes
// from the general queue. Studio clearance is the one desk that pitches nothing: its run re-checks what the other desks filed.
import type { Agent } from "../actions";
import type { EntityType } from "../qloo";
import type { DeskId } from "../personas";
import type { Purpose } from "../desks/common";
import type { Side } from "../match";
import { metroMap } from "../match";
import { sql } from "../db";
import { PERSONAS, customOf, type CustomEntity } from "../personas";
import { profile, resolve, top } from "./qx";

export type Sig = { name: string; type: EntityType };

export type Lane = {
  desk: DeskId; agent: Agent; purpose: Purpose; n: number;
  action: "ambassador_pitch" | "sponsor_pitch" | "podcast_pitch" | "email" | "hold_request" | "collab_pitch" | "booking_pitch";
  signal: Sig[];                                   // whose audience the agents read, all together (one type per lane)
  target?: EntityType;                             // what the lane pitches: brands (default), artists, people or rooms
  audience?: string;                               // how a big signal is named in steps and drafts ("the Golden Globes TV nominees")
  location?: string;                               // Qloo signal.location.query: the lane reads that city's taste
  within?: string;                                 // Qloo filter.location.query: candidates must be in that city (rooms)
  exclude?: string[];                              // names never pitched by this lane (acts a room already booked)
  popularity?: [number, number];                   // Qloo popularity band a candidate must sit in (acts a room can fit)
  side?: Side;                                     // what our match score compares against, when it isn't the signal itself
  speaker: string;                                 // who the pitch is for
  talent: string | null;                           // talent named in the message (Clearance checks their exclusive deals)
  tags?: string[];                                 // Qloo brand genre tags the candidates must carry (a co-brand stays in category)
  facts?: string[];                                // what the desk already knows (a room's size, its recent acts)
  title: (org: string) => string;
  ask: (org: string) => string;
};

export type PitchPlan = { kind: "pitch"; city: string; lanes: Lane[] | (() => Promise<Lane[]>) };
export type ReviewPlan = { kind: "review"; n: number };
export type Plan = PitchPlan | ReviewPlan;

// The board's columns. A review run walks a filed card back through Clearance's own steps.
export const PITCH_COLS = ["Spotted", "Checked", "Person found", "Drafted", "Clearance", "Your approval"];
export const REVIEW_COLS = ["Picked up", "Deals checked", "Person re-checked", "Wording checked", "Ruled", "Your sign-off"];
export const colsFor = (personaId: string) => (planOf(personaId)?.kind === "review" ? REVIEW_COLS : PITCH_COLS);

const T = (k: string) => `urn:tag:genre:brand:${k}`;
const ROOMS = ["arena", "stadium"].map(k => `urn:tag:category:place:${k}`);

/** Rooms to hold for an artist: the cities where the fans concentrate most (Qloo's heatmap), and in each the arenas and
 *  stadiums those fans lean toward. Cities where Qloo lists no such room are skipped. */
async function holdLanes(artist: string, n: number): Promise<Lane[]> {
  const e = await resolve(artist, "artist");
  if (!e) return [];
  const cells = [...new Set((await profile(e.id)).cells)];
  const out: Lane[] = [];
  for (const [i, city] of cells.slice(0, 5).entries()) {
    if (out.length >= n) break;
    if (!(await top([e.id], "place", 40, ROOMS, undefined, city).catch(() => [])).length) continue;
    out.push({
      desk: "tour", agent: "scout", action: "hold_request", purpose: "booking", n: 1, target: "place", tags: ROOMS, within: city,
      signal: [{ name: artist, type: "artist" }], speaker: artist, talent: artist,
      facts: [`${city} is number ${i + 1} on Qloo's heatmap of where ${artist}'s fans concentrate.`],
      title: org => `Hold ${org} for ${artist}`,
      ask: org => `A hold request to ${org}'s booking team: which dates they could hold for a ${artist} arena or stadium show in the next touring window, and who should get the offer. Say why: ${artist}'s fans in ${city} lean toward this room in Qloo's taste data. Ask them to reply with dates.`,
    });
  }
  return out;
}

/** A feature (artists) or a joint project (people): who this one's fans lean toward, measured back the other way. */
function collabLane(name: string, type: "artist" | "person", exclude: string[] = []): Lane {
  const feature = type === "artist";
  return {
    desk: "talent", agent: "scout", action: "collab_pitch", purpose: "management", n: 1, target: type, exclude,
    signal: [{ name, type }], speaker: name, talent: name,
    title: org => `${name} × ${org}: ${feature ? "a feature" : "a joint project"}`,
    ask: org => feature
      ? `A collaboration pitch to ${org}'s management from ${name}'s team: a feature together (a track, a remix or a guest spot on a live date), because the two artists' fans lean toward each other in Qloo's taste data, both ways. Ask them to reply if ${org} is open to it.`
      : `A collaboration pitch to ${org}'s team from ${name}'s: a joint project (a special, a podcast episode or a campaign together), because their fans lean toward each other in Qloo's taste data, both ways. Ask them to reply if ${org} is open to it.`,
  };
}
const lineup = PERSONAS.find(p => p.id === "golden-globes-partnerships")!.lineup!;
const NOMINEES: Sig[] = lineup.members.map(name => ({ name, type: "tv_show" }));

/** Three Live Nation rooms with known recent acts, the least-pitched first: each room's crowd is the fans of who plays there. */
async function rooms(): Promise<Lane[]> {
  const rs = (await sql()`
    select v.name, v.metro, v.capacity_est, v.profile->'recentActs' acts, v.profile->'tags' tags,
      (select count(*) from permission_requests r where r.persona = 'live-nation-sponsorship' and r.title like '% at ' || v.name)::int pitched
    from venues v where v.live_nation and jsonb_array_length(coalesce(v.profile->'recentActs', '[]'::jsonb)) >= 4
    order by pitched, random() limit 3`) as { name: string; metro: string; capacity_est: number; acts: string[]; tags: string[] | null; pitched: number }[];
  // Rooms sell to the categories venues actually sign (drinks, fashion, banking); left open, Qloo's list for a crowd
  // includes brands no room would sell to (Getty Images, 23 Oct).
  const CATS = ["food_and_beverage", "fashion", "financial_services"];
  // Who to book next in two of the rooms: acts the crowd leans toward that haven't played there, inside the popularity band
  // of the acts that have (a 1,200-cap room doesn't get pitched Karol G).
  const bookings: Lane[] = [];
  for (const r of rs.slice(0, 2)) {
    const pops = (await Promise.all(r.acts.slice(0, 8).map(a => resolve(a, "artist")))).map(e => e?.popularity).filter((x): x is number => x != null);
    if (pops.length < 2) continue;
    bookings.push({
      desk: "venue", agent: "scout", action: "booking_pitch", purpose: "management", n: 1, target: "artist",
      signal: r.acts.slice(0, 6).map(name => ({ name, type: "artist" as const })), exclude: r.acts,
      popularity: [Math.min(...pops) * 0.97, Math.max(...pops) * 1.01],
      audience: `the crowd at ${r.name}`, speaker: r.name, talent: null,
      facts: [`${r.name} is a Live Nation room in ${r.metro} that holds about ${r.capacity_est.toLocaleString("en-US")}.`,
        `Recent acts there: ${r.acts.slice(0, 5).join(", ")}. Qloo read the fans of those acts as the room's crowd.`],
      title: org => `Book ${org} at ${r.name}`,
      ask: org => `A booking pitch to ${org}'s agent: a headline date at ${r.name} in ${r.metro} (about ${r.capacity_est.toLocaleString("en-US")} capacity), because the fans of the acts who play there lean toward ${org} in Qloo's taste data. Ask which touring windows they have.`,
    });
  }
  return [...bookings, ...rs.map((r, i): Lane => ({
    desk: "venue", agent: "scout", action: "sponsor_pitch", purpose: "sponsorship", n: 1, tags: [T(CATS[i % CATS.length])],
    signal: r.acts.slice(0, 6).map(name => ({ name, type: "artist" as const })),
    audience: `the crowd at ${r.name}`, location: r.metro,
    side: { name: r.name, tags: new Set(r.tags ?? []), age: null, metros: metroMap([r.metro]) },
    speaker: r.name, talent: null,
    facts: [`${r.name} is a Live Nation room in ${r.metro} that holds about ${r.capacity_est.toLocaleString("en-US")}.`,
      `Recent acts there: ${r.acts.slice(0, 5).join(", ")}. Qloo read the fans of those acts, in ${r.metro}, as the room's crowd.`],
    title: org => `${org} at ${r.name}`,
    ask: org => `A venue sponsorship pitch to ${org}: a season partnership at ${r.name} in ${r.metro} (on-site activation, presale access and a named bar), because the fans of the acts it books lean toward ${org}. Ask them to reply if they want the full numbers.`,
  }))];
}

export const PLANS: Record<string, Plan> = {
  // Bad Bunny's team: sponsors for the tour, rooms to hold where the fans are, a feature, and an ambassador deal.
  "bad-bunny-touring": {
    kind: "pitch", city: "Miami",
    lanes: async () => [
      { desk: "sponsorship", agent: "scout", action: "sponsor_pitch", purpose: "sponsorship", n: 2,
        signal: [{ name: "Bad Bunny", type: "artist" }], speaker: "Bad Bunny", talent: "Bad Bunny",
        title: org => `${org} as a Bad Bunny tour sponsor`,
        ask: org => `A sponsorship pitch: offer ${org} a presenting partnership on Bad Bunny's next tour leg, led by the cities where both audiences concentrate. Ask them to reply if they want the full numbers.` },
      ...await holdLanes("Bad Bunny", 2),
      collabLane("Bad Bunny", "artist"),
      { desk: "talent", agent: "scout", action: "ambassador_pitch", purpose: "partnerships", n: 1,
        signal: [{ name: "Bad Bunny", type: "artist" }], speaker: "Bad Bunny", talent: "Bad Bunny",
        title: org => `Bad Bunny × ${org}: ambassador deal`,
        ask: org => `An ambassador pitch to ${org}'s partnerships team: a 12-month Bad Bunny ambassador deal, built on how the two audiences overlap. Ask who runs talent partnerships.` },
    ],
  },
  "cedric-brands": {
    kind: "pitch", city: "Atlanta",
    lanes: [
      { desk: "talent", agent: "scout", action: "ambassador_pitch", purpose: "partnerships", n: 2,
        signal: [{ name: "Cedric the Entertainer", type: "person" }], speaker: "Cedric the Entertainer", talent: "Cedric the Entertainer",
        title: org => `Cedric the Entertainer × ${org}: ambassador deal`,
        ask: org => `An ambassador pitch to ${org}: a campaign with Cedric the Entertainer, built on how close ${org}'s audience is to Cedric's fans. Ask who runs talent partnerships.` },
      // AC Barbeque is Cedric's and Anthony Anderson's, so the agents read both men's fans together.
      { desk: "sales", agent: "scout", action: "sponsor_pitch", purpose: "partnerships", n: 1,
        signal: [{ name: "Cedric the Entertainer", type: "person" }, { name: "Anthony Anderson", type: "person" }], speaker: "AC Barbeque", talent: null,
        tags: [T("food_and_beverage")],
        title: org => `AC Barbeque × ${org}: co-branded drop`,
        ask: org => `A co-branding pitch from AC Barbeque to ${org}: a limited co-branded product or a joint promotion, because the fans of AC Barbeque's founders lean toward ${org}. Ask them to reply if they want the full numbers.` },
      { desk: "sales", agent: "scout", action: "sponsor_pitch", purpose: "partnerships", n: 1,
        signal: [{ name: "Cedric the Entertainer", type: "person" }], speaker: "Setta Wines", talent: null,
        tags: [T("food_and_beverage:food")],
        title: org => `Setta Wines × ${org}: co-branded drop`,
        ask: org => `A co-branding pitch from Setta Wines, Cedric the Entertainer's wine label, to ${org}: a pairing, a gift set or a joint promotion, because Cedric's fans lean toward ${org}. Ask them to reply if they want the full numbers.` },
      // Anthony Anderson is already his partner in AC Barbeque.
      collabLane("Cedric the Entertainer", "person", ["Anthony Anderson"]),
    ],
  },
  // The show's audience is its nominees' audiences together. Left alone, Qloo's list for them is all cars, so each lane
  // holds a category an awards broadcast actually sells.
  "golden-globes-partnerships": {
    kind: "pitch", city: "Los Angeles",
    lanes: ([["wine_and_spirits", "spirits and wine"], ["fashion", "fashion"], ["travel", "travel"]] as const).map(([tag, cat]) => ({
      desk: "sponsorship" as const, agent: "scout" as const, action: "sponsor_pitch" as const, purpose: "sponsorship" as const, n: 1,
      signal: NOMINEES, audience: "the Golden Globes TV nominees", speaker: "Golden Globes", talent: null, tags: [T(tag)],
      facts: [`The nominees read together: ${lineup.members.join(", ")} (Best Television Series, 83rd Golden Globes).`],
      title: (org: string) => `${org} for the Golden Globes broadcast`,
      ask: (org: string) => `A sponsorship pitch to ${org}: the ${cat} category partnership on the Golden Globes broadcast, because the audiences of this year's nominated series lean toward ${org}. Ask them to reply if they want the full numbers.`,
    })),
  },
  "twist-sponsorship": {
    kind: "pitch", city: "San Francisco",
    lanes: ([["software", 2, "software"], ["financial_services", 1, "fintech and financial"]] as const).map(([tag, n, cat]) => ({
      desk: "podcast" as const, agent: "scout" as const, action: "podcast_pitch" as const, purpose: "sponsorship" as const, n,
      signal: [{ name: "This Week in Startups", type: "podcast" as const }], audience: "This Week in Startups' listeners",
      speaker: "This Week in Startups", talent: null, tags: [T(tag)],
      title: (org: string) => `${org} sponsoring This Week in Startups`,
      ask: (org: string) => `An ad-sales pitch to ${org}: a run of host-read sponsor spots on This Week in Startups, offered to ${cat} brands its listeners already lean toward. Ask them to reply if they want the rate card and the numbers.`,
    })),
  },
  // Qloo's own sales seat works the other judges' networks: the consumer brands their fans lean toward are the brands
  // that would buy what Qloo knows about those fans. SYZYGY writes as Qloo's outbound team and never as Qloo.
  "qloo-enterprise": {
    kind: "pitch", city: "New York",
    lanes: ([
      [{ name: "Bad Bunny", type: "artist" }, "Bad Bunny's fans", "fashion"],
      [{ name: "Cedric the Entertainer", type: "person" }, "Cedric the Entertainer's fans", "food_and_beverage"],
      [{ name: "This Week in Startups", type: "podcast" }, "This Week in Startups' listeners", "financial_services"],
    ] as const).map(([sig, aud, tag]) => ({
      desk: "sales" as const, agent: "scout" as const, action: "email" as const, purpose: "insights" as const, n: 1,
      signal: [sig as Sig], audience: aud, speaker: "Qloo", talent: null, tags: [T(tag)],
      title: (org: string) => `${org}: pitch Qloo's taste data, led by ${aud}`,
      ask: (org: string) => `A data sales pitch to ${org}'s consumer insights team, from SYZYGY, the AI agent team working as Qloo's outbound desk (never write as Qloo itself or "on behalf of Qloo"): the number below is one line of what Qloo's taste data knows about ${org}'s audience; Qloo's Insights API gives the same read across music, film, TV, dining and travel. Ask them to reply if they want a sample read for their brand.`,
    })),
  },
  "live-nation-sponsorship": { kind: "pitch", city: "Los Angeles", lanes: rooms },
  "studio-clearance": { kind: "review", n: 4 },
};

/** A desk someone set up for their own brand, artist, person or show: lanes picked by what Qloo says it is. */
export function customPlan(e: CustomEntity): PitchPlan {
  const me = e.name, s: Sig[] = [{ name: me, type: e.type }];
  const brands = (desk: DeskId, n: number, title: (o: string) => string, ask: (o: string) => string, action: Lane["action"] = "sponsor_pitch"): Lane =>
    ({ desk, agent: "scout", action, purpose: "sponsorship", n, signal: s, speaker: me, talent: e.type === "artist" || e.type === "person" ? me : null, title, ask });
  const why = (o: string) => `because ${me}'s audience leans toward ${o} in Qloo's taste data, both ways. Ask them to reply if they want the full numbers.`;
  switch (e.type) {
    case "brand": return { kind: "pitch", city: "New York", lanes: [
      { ...brands("sales", 2, o => `${me} × ${o}: co-branded drop`, o => `A co-branding pitch from ${me} to ${o}: a limited co-branded product or a joint promotion, ${why(o)}`), purpose: "partnerships" },
      { desk: "talent", agent: "scout", action: "ambassador_pitch", purpose: "management", n: 1, target: "artist", signal: s, speaker: me, talent: null,
        title: o => `${o} as ${me}'s ambassador`,
        ask: o => `An ambassador pitch to ${o}'s management from ${me}: a campaign with ${o}, because ${o}'s fans and ${me}'s audience lean toward each other in Qloo's taste data. Ask them to reply if ${o} is open to it.` },
    ] };
    case "artist": return { kind: "pitch", city: "Los Angeles", lanes: async () => [
      brands("sponsorship", 2, o => `${o} as a ${me} tour sponsor`, o => `A sponsorship pitch: offer ${o} a presenting partnership on ${me}'s next tour, ${why(o)}`),
      ...await holdLanes(me, 1),
      collabLane(me, "artist"),
    ] };
    case "person": return { kind: "pitch", city: "Los Angeles", lanes: [
      { ...brands("talent", 2, o => `${me} × ${o}: ambassador deal`, o => `An ambassador pitch to ${o}: a campaign with ${me}, ${why(o)}`, "ambassador_pitch"), agent: "scout", purpose: "partnerships" },
      collabLane(me, "person"),
    ] };
    case "podcast": return { kind: "pitch", city: "New York", lanes: [
      brands("podcast", 3, o => `${o} sponsoring ${me}`, o => `An ad-sales pitch to ${o}: a run of host-read sponsor spots on ${me}, ${why(o)}`, "podcast_pitch"),
    ] };
    default: return { kind: "pitch", city: "Los Angeles", lanes: [
      brands("sponsorship", 3, o => `${o} sponsoring ${me}`, o => `A sponsorship pitch to ${o}: a partnership around ${me}, ${why(o)}`),
    ] };
  }
}

/** The plan for any desk, custom ones included (their persona must be loaded first: loadPersona). */
export function planOf(personaId: string): Plan | undefined {
  if (PLANS[personaId]) return PLANS[personaId];
  const e = customOf(personaId);
  return e ? customPlan(e) : undefined;
}

export const isLive = (personaId: string) => !!planOf(personaId);
