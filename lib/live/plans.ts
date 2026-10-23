// What each persona's agents work on in a live run: whose audience they read in Qloo, what they pitch off it, and how many
// cards each lane makes. Everything here is a connection of the persona's own brands or talent; nothing comes from the
// general queue. A persona is live once it has a plan here (Bad Bunny and Cedric first, then the other judges).
import type { Agent } from "../actions";
import type { EntityType } from "../qloo";
import type { DeskId } from "../personas";
import type { Purpose } from "../desks/common";

export type Lane = {
  desk: DeskId; agent: Agent; action: "ambassador_pitch" | "sponsor_pitch" | "podcast_pitch"; purpose: Purpose; n: number;
  signal: { name: string; type: EntityType }[];   // whose audience the agents read; the first one is scored against
  speaker: string;                                 // who the pitch is for
  talent: string | null;                           // talent named in the message (Clearance checks their exclusive deals)
  tags?: string[];                                 // Qloo brand genre tags the candidates must carry (a co-brand stays in category)
  title: (org: string) => string;
  ask: (org: string) => string;
};

export type Plan = { lanes: Lane[]; city: string };

export const PLANS: Record<string, Plan> = {
  "bad-bunny-touring": {
    city: "Miami",
    lanes: [
      { desk: "sponsorship", agent: "sponsor", action: "sponsor_pitch", purpose: "sponsorship", n: 2,
        signal: [{ name: "Bad Bunny", type: "artist" }], speaker: "Bad Bunny", talent: "Bad Bunny",
        title: org => `${org} as a Bad Bunny tour sponsor`,
        ask: org => `A sponsorship pitch: offer ${org} a presenting partnership on Bad Bunny's next tour leg, led by the cities where both audiences concentrate. Ask them to reply if they want the full numbers.` },
      { desk: "talent", agent: "talent", action: "ambassador_pitch", purpose: "partnerships", n: 2,
        signal: [{ name: "Bad Bunny", type: "artist" }], speaker: "Bad Bunny", talent: "Bad Bunny",
        title: org => `Bad Bunny × ${org}: ambassador deal`,
        ask: org => `An ambassador pitch to ${org}'s partnerships team: a 12-month Bad Bunny ambassador deal, built on how the two audiences overlap. Ask who runs talent partnerships.` },
    ],
  },
  "cedric-brands": {
    city: "Atlanta",
    lanes: [
      { desk: "talent", agent: "talent", action: "ambassador_pitch", purpose: "partnerships", n: 2,
        signal: [{ name: "Cedric the Entertainer", type: "person" }], speaker: "Cedric the Entertainer", talent: "Cedric the Entertainer",
        title: org => `Cedric the Entertainer × ${org}: ambassador deal`,
        ask: org => `An ambassador pitch to ${org}: a campaign with Cedric the Entertainer, built on how close ${org}'s audience is to Cedric's fans. Ask who runs talent partnerships.` },
      // AC Barbeque is Cedric's and Anthony Anderson's, so the agents read both men's fans together.
      { desk: "sales", agent: "sponsor", action: "sponsor_pitch", purpose: "partnerships", n: 1,
        signal: [{ name: "Cedric the Entertainer", type: "person" }, { name: "Anthony Anderson", type: "person" }], speaker: "AC Barbeque", talent: null,
        tags: ["urn:tag:genre:brand:food_and_beverage"],
        title: org => `AC Barbeque × ${org}: co-branded drop`,
        ask: org => `A co-branding pitch from AC Barbeque to ${org}: a limited co-branded product or a joint promotion, because the fans of AC Barbeque's founders lean toward ${org}. Ask them to reply if they want the full numbers.` },
      { desk: "sales", agent: "sponsor", action: "sponsor_pitch", purpose: "partnerships", n: 1,
        signal: [{ name: "Cedric the Entertainer", type: "person" }], speaker: "Setta Wines", talent: null,
        tags: ["urn:tag:genre:brand:food_and_beverage:food"],
        title: org => `Setta Wines × ${org}: co-branded drop`,
        ask: org => `A co-branding pitch from Setta Wines, Cedric the Entertainer's wine label, to ${org}: a pairing, a gift set or a joint promotion, because Cedric's fans lean toward ${org}. Ask them to reply if they want the full numbers.` },
    ],
  },
};

export const isLive = (personaId: string) => personaId in PLANS;
