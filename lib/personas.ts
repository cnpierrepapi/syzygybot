// Who is using SYZYGY. A persona is what someone does (their role, which decides the desks they see) plus who they do it
// for (the subject the desks work on). The demo persona is Bad Bunny's touring lead; there is one more per judge, named.
// Market Watch is on for everyone, tuned to what that person would act on.

export type DeskId = "pitches" | "sales" | "tour" | "sponsorship" | "talent" | "venue" | "podcast" | "watch" | "clearance";

export const DESKS: Record<DeskId, { label: string; agent: string; blurb: string }> = {
  pitches: { label: "SYZYGY pitches", agent: "Scout → Writer", blurb: "SYZYGY's own emails about this audience, signed by SYZYGY. Approve one and it really goes out, to an address that was published or verified." },
  sales: { label: "Brand Partnerships", agent: "Scout → Writer", blurb: "Finds the brand that needs this audience, the person who buys, and writes the pitch." },
  tour: { label: "Tour & Venues", agent: "Router", blurb: "Routes the tour where the fans are, picks rooms by what they book and their size, drafts hold requests." },
  sponsorship: { label: "Event Sponsorship", agent: "Sponsor", blurb: "Adds up the lineup's audiences and pitches the brands that audience leans toward." },
  talent: { label: "Talent & Ambassadors", agent: "Talent", blurb: "Brands that fit the talent and talent that fits the brand, with exclusivity checked first." },
  venue: { label: "Venue Desk", agent: "Venue", blurb: "For each room: who to book next, and which brands to sell its sponsorship to." },
  podcast: { label: "Podcast & Creator", agent: "Podcast", blurb: "Matches sponsors to a show's audience and drafts the ad-sales pitch." },
  watch: { label: "Market Watch", agent: "Watch", blurb: "Reads the trades, press releases and announcements around the clock and flags what to act on." },
  clearance: { label: "Clearance", agent: "Clearance", blurb: "Holds anything that breaks a rule before it reaches a person, and records why." },
};

export type RoleId = "tour" | "venue" | "sponsorship" | "talent" | "brand" | "media" | "clearance";

export const ROLES: Record<RoleId, { label: string; desks: DeskId[] }> = {
  tour: { label: "I plan tours", desks: ["tour", "sponsorship", "talent", "watch"] },
  venue: { label: "I run venues or sell their sponsorship", desks: ["venue", "tour", "sponsorship", "watch"] },
  sponsorship: { label: "I sell sponsorship for an event or show", desks: ["sponsorship", "talent", "watch"] },
  talent: { label: "I manage talent and their brands", desks: ["talent", "sales", "watch"] },
  brand: { label: "I sell to brands", desks: ["sales", "watch"] },
  media: { label: "I run a podcast or a channel", desks: ["podcast", "watch"] },
  clearance: { label: "I sign off on what goes out", desks: ["clearance", "watch"] },
};

export type Persona = {
  id: string;
  title: string;            // the job, as the drop-down shows it
  judge: string | null;     // the judge this persona was written for
  who: string;              // who this person is
  forWhom: string;          // who they work for
  role: RoleId;
  subject: string;          // the corpus entity (or look-alike profile) the desks work on
  watch: string[];          // what Market Watch reads for, in order of weight
  news: string[];           // the news searches behind it (Google News syntax), one per line of interest
  groups: string[];         // which curated trade-press groups (lib/sources.ts) Market Watch searches
  roomSize?: [number, number];
  lineup?: { name: string; members: string[] };
  brands?: string[];        // the persona's own brands (look-alike profiles)
  demo?: boolean;
  extraDesks?: DeskId[];    // desks on top of the role's, shown first
  realSends?: boolean;      // approving an email on its pitches desk sends it for real (letters stay simulated)
  image?: string | null;    // the desk's picture; judges' desks use /judges/<id>.jpg
};

export const PERSONAS: Persona[] = [
  {
    id: "bad-bunny-touring", demo: true, judge: null, extraDesks: ["pitches"], realSends: true,
    title: "Head of touring and partnerships, Bad Bunny",
    who: "Runs the tour and the brand deals that ride on it.",
    forWhom: "Bad Bunny, whose fans concentrate in Puerto Rico, the Dominican Republic, the Texas border and Miami.",
    role: "tour", subject: "Bad Bunny", roomSize: [10000, 60000],
    news: ["reggaeton OR \"Latin artist\" stadium tour announced", "Coliseo de Puerto Rico OR \"Kaseya Center\" concert", "Latin festival lineup announced", "\"Bad Bunny\" OR \"Karol G\" OR \"Peso Pluma\" brand deal", "\"chief marketing officer\" appointed sportswear OR beverage OR fashion"],
    groups: ["live", "music", "talent", "marketing", "sports"],
    watch: [
      "stadium and arena tour announcements by Latin and reggaeton artists",
      "venue openings, closures and renovations in Puerto Rico, Miami and Texas",
      "festival lineup announcements in the US and Latin America",
      "brand deals signed by rival Latin artists",
      "new chief marketing officers at fashion, sportswear and beverage brands",
    ],
  },
  {
    id: "twist-sponsorship", judge: "Jason Calacanis",
    title: "Sponsorship lead, This Week in Startups",
    who: "Sells the ad slots on the show.",
    forWhom: "This Week in Startups, Jason Calacanis's podcast for founders and angel investors.",
    role: "media", subject: "This Week in Startups",
    news: ["startup raises Series A OR \"Series B\" consumer", "startup launches product founders", "podcast sponsorship deal advertisers", "startup hires \"chief marketing officer\" OR \"head of growth\""],
    groups: ["tech", "marketing", "media_business", "business"],
    watch: [
      "startup funding rounds of $10M or more in consumer, fintech and developer tools",
      "startup product launches",
      "new sponsors on tech and business podcasts",
      "marketing and growth leadership hires at venture-backed startups",
    ],
  },
  {
    id: "qloo-enterprise", judge: "Mike Diolosa",
    title: "Enterprise sales, Qloo",
    who: "Brings brands and agencies to Qloo's table.",
    forWhom: "Qloo, with SYZYGY working as its own outbound sales team.",
    role: "brand", subject: "Qloo",
    news: ["\"chief marketing officer\" appointed consumer brand", "\"consumer insights\" head appointed", "brand partnership announced artist", "agency wins account review", "audience data OR \"taste data\" company"],
    groups: ["marketing", "pr", "media_business", "business"],
    watch: [
      "new chief marketing officers and heads of consumer insights at consumer brands",
      "brand and artist partnership announcements",
      "agency account wins and losses",
      "news from consumer-insights and audience-data companies",
    ],
  },
  {
    id: "studio-clearance", judge: "Nicole Seligman",
    title: "Head of clearance, film and music studio",
    who: "Signs off on everything the agents send, sets the rules, and keeps the record.",
    forWhom: "A studio's legal and brand-safety office, reviewing every desk's outbound queue.",
    role: "clearance", subject: "Clearance",
    news: ["\"AI Act\" transparency OR \"Article 50\"", "FTC endorsement OR influencer enforcement", "\"right of publicity\" lawsuit OR \"NO FAKES\"", "CASL OR GDPR OR \"CAN-SPAM\" fine marketing", "exclusive endorsement deal signs"],
    groups: ["marketing", "media_business", "talent", "business"],
    watch: [
      "EU AI Act transparency rules and enforcement",
      "FTC endorsement guides and influencer enforcement",
      "right of publicity laws and lawsuits over a celebrity's name or likeness",
      "anti-spam and consent rules: CAN-SPAM, CASL, GDPR, PECR",
      "exclusive brand deals signed by artists and actors",
    ],
  },
  {
    id: "golden-globes-partnerships", judge: "Todd Boehly",
    title: "Partnerships lead, Golden Globes",
    who: "Sells the show's sponsorships and brand integrations.",
    forWhom: "The Golden Globes (Dick Clark Productions, an Eldridge company).",
    role: "sponsorship", subject: "Golden Globes",
    // Best Television Series, Drama and Musical or Comedy, 83rd Golden Globes (nominated 8 Dec 2025).
    lineup: {
      name: "Golden Globes TV nominees",
      members: ["The Diplomat", "The Pitt", "Pluribus", "Severance", "Slow Horses", "The White Lotus",
        "Abbott Elementary", "The Bear", "Hacks", "Nobody Wants This", "Only Murders in the Building", "The Studio"],
    },
    news: ["\"Golden Globes\" OR Emmys OR Oscars OR Grammys sponsor", "award season nominations 2027", "actor signs brand ambassador deal", "\"chief marketing officer\" luxury OR auto OR beverage appointed"],
    groups: ["film_tv", "media_business", "talent", "marketing", "awards"],
    watch: [
      "award season news: Golden Globes, Emmys, Oscars and Grammys",
      "brand deals signed by nominated actors and shows",
      "sponsors of the Oscars, Emmys and Grammys broadcasts",
      "new chief marketing officers at luxury, auto, beverage and tech brands",
    ],
  },
  {
    id: "cedric-brands", judge: "Cedric the Entertainer",
    title: "Brand partnerships, Cedric the Entertainer's companies",
    who: "Finds partners for Cedric and for the brands he owns.",
    forWhom: "Cedric the Entertainer and his brands: AC Barbeque, Setta Wines, Who Ced and A Bird and a Bear Entertainment.",
    role: "talent", subject: "Cedric the Entertainer",
    brands: ["AC Barbeque", "Setta Wines", "Who Ced", "A Bird and a Bear Entertainment"],
    news: ["barbecue sauce OR \"BBQ\" brand launch", "wine OR spirits celebrity brand launch", "comedian brand deal ambassador", "food festival OR \"wine festival\" sponsor"],
    groups: ["food_bev", "drinks", "talent", "marketing"],
    watch: [
      "barbecue, sauce, wine and spirits product launches",
      "brands signing comedians and Black-led TV talent",
      "celebrity-owned food and drink brands",
      "food and wine festival sponsorships",
    ],
  },
  {
    id: "live-nation-sponsorship", judge: "Michael Abrams",
    title: "Sponsorship, Live Nation venues and tours",
    who: "Sells sponsorship across the rooms and the tours that play them.",
    forWhom: "Live Nation's venues, starting with the House of Blues and Fillmore rooms in the corpus.",
    role: "venue", subject: "Live Nation",
    news: ["arena OR amphitheater tour announced 2027", "venue naming rights deal", "experiential marketing live events brand", "\"AEG Presents\" OR \"Live Nation\" deal"],
    groups: ["live", "music", "marketing", "sports"],
    watch: [
      "arena and amphitheater tour announcements",
      "venue openings and naming-rights deals",
      "brands' experiential and live-event marketing spend",
      "AEG Presents and other promoter deals",
    ],
  },
];

// Desks visitors set up for their own brand, artist, person or show (/desk, "find yours"). They live in custom_desks and are
// loaded into this process before anything reads them, so persona() stays a plain lookup. A "business" desk is one Qloo has
// no record of: it was set up from the business's own site, and its runs read the audience through anchors (lib/live/anchors).
export type CustomEntity = { id: string; name: string; type: "brand" | "artist" | "person" | "tv_show" | "movie" | "podcast" | "business"; site?: string | null; about?: string | null };
const custom = new Map<string, Persona & { entity: CustomEntity }>();
const ROLE_OF: Record<CustomEntity["type"], RoleId> = { brand: "talent", artist: "tour", person: "talent", tv_show: "sponsorship", movie: "sponsorship", podcast: "media", business: "brand" };
const KIND: Record<CustomEntity["type"], string> = { brand: "brand", artist: "artist", person: "talent", tv_show: "show", movie: "film", podcast: "podcast", business: "business" };
const deskOf = (name: string) => `${name}${/s$/i.test(name) ? "'" : "'s"} desk`;
const hostName = (u?: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return u ?? ""; } };

export function customPersona(id: string, e: CustomEntity, image: string | null = null): Persona & { entity: CustomEntity } {
  if (e.type === "business") return {
    id, judge: null, image, title: deskOf(e.name), entity: e,
    who: `A desk set up for ${e.name} from its own site, ${hostName(e.site)}.${e.about ? ` ${e.about}` : ""}`,
    forWhom: `It isn't in Qloo, so the agents read it through anchors Qloo does know.`,
    role: "brand", extraDesks: ["talent", "podcast"], subject: e.name, watch: [], news: [], groups: [],
  };
  return {
    id, judge: null, image, title: deskOf(e.name), entity: e,
    who: `A desk set up for ${e.name} from Qloo's record of the ${KIND[e.type]}.`,
    forWhom: `The agents read ${e.name}'s audience in Qloo and work the deals it points to.`,
    role: ROLE_OF[e.type], subject: e.name, watch: [], news: [], groups: [],
  };
}

export const persona = (id: string) => PERSONAS.find(p => p.id === id) ?? custom.get(id);
export const customOf = (id: string) => custom.get(id)?.entity ?? null;

/** persona() for any id, custom desks included (read from the database once per process). */
export async function loadPersona(id: string) {
  const known = persona(id);
  if (known || !/^my-[a-z0-9-]{2,80}$/.test(id)) return known;
  const { sql } = await import("./db");
  const [row] = (await sql()`select id, entity_id, name, type, image, site, about from custom_desks where id = ${id}`) as { id: string; entity_id: string; name: string; type: CustomEntity["type"]; image: string | null; site: string | null; about: string | null }[];
  if (!row) return undefined;
  const p = customPersona(row.id, { id: row.entity_id, name: row.name, type: row.type, site: row.site, about: row.about }, row.image);
  custom.set(row.id, p);
  return p;
}
export const desksFor = (p: Persona) => [...(p.extraDesks ?? []), ...ROLES[p.role].desks];
