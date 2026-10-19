// Who is using SYZYGY. A persona is what someone does (their role, which decides the desks they see) plus who they do it
// for (the subject the desks work on). The demo persona is Bad Bunny's touring lead; there is one more per judge, named.
// Market Watch is on for everyone, tuned to what that person would act on.

export type DeskId = "sales" | "tour" | "sponsorship" | "talent" | "venue" | "podcast" | "watch" | "clearance";

export const DESKS: Record<DeskId, { label: string; agent: string; blurb: string }> = {
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
  roomSize?: [number, number];
  lineup?: { name: string; members: string[] };
  brands?: string[];        // the persona's own brands (look-alike profiles)
  demo?: boolean;
};

export const PERSONAS: Persona[] = [
  {
    id: "bad-bunny-touring", demo: true, judge: null,
    title: "Head of touring and partnerships, Bad Bunny",
    who: "Runs the tour and the brand deals that ride on it.",
    forWhom: "Bad Bunny, whose fans concentrate in Puerto Rico, the Dominican Republic, the Texas border and Miami.",
    role: "tour", subject: "Bad Bunny", roomSize: [10000, 60000],
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
    watch: [
      "arena and amphitheater tour announcements",
      "venue openings and naming-rights deals",
      "brands' experiential and live-event marketing spend",
      "AEG Presents and other promoter deals",
    ],
  },
];

export const persona = (id: string) => PERSONAS.find(p => p.id === id);
export const desksFor = (p: Persona) => ROLES[p.role].desks;
