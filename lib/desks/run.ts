// Runs a persona's desks. Each desk tops its queue up to a few open requests per run, so the hourly cron keeps every
// persona's dashboard fresh without flooding it.
import { PERSONAS, desksFor, type Persona } from "../personas";
import { runTour } from "./tour";
import { runAmbassador, runLineupSponsors, runSponsorForTalent } from "./brands";
import { runSales } from "./sales";
import { runVenueDesk } from "./venue";
import { runPodcast } from "./podcast";
import { runPatternTalent } from "./pattern";
import { runWatch } from "./watch";

type Job = () => Promise<string[]>;

function jobs(p: Persona): Record<string, Job> {
  switch (p.id) {
    case "bad-bunny-touring": return {
      tour: () => runTour(p, "Bad Bunny"),
      sponsorship: () => runSponsorForTalent(p, "Bad Bunny", 3),
      talent: () => runAmbassador(p, "Bad Bunny", 3),
    };
    case "golden-globes-partnerships": return {
      sponsorship: () => runLineupSponsors(p, 4),
      talent: () => runAmbassador(p, "The Bear", 2),
    };
    case "live-nation-sponsorship": return {
      venue: () => runVenueDesk(p, 4),
      tour: () => runTour({ ...p, roomSize: [1500, 6000] }, "Charli XCX", { stops: 3, liveNationOnly: true }),
      sponsorship: () => runSponsorForTalent(p, "Charli XCX", 2),
    };
    case "cedric-brands": return {
      talent: () => runPatternTalent(p, "Cedric the Entertainer", 3),
      sales: () => runPatternTalent(p, "AC Barbeque", 2, "sales"),
    };
    case "twist-sponsorship": return { podcast: () => runPodcast(p, 4) };
    case "qloo-enterprise": return { sales: () => runSales(p, 6) };
    default: return {};
  }
}

export async function runPersona(p: Persona, only?: string[]) {
  const out: Record<string, number | string> = {};
  const all = { ...jobs(p), watch: () => runWatch(p) };
  for (const desk of desksFor(p)) {
    const job = all[desk as keyof typeof all];
    if (!job || (only && !only.includes(desk))) continue;
    try { out[desk] = (await job()).length; }
    catch (e) { out[desk] = `failed: ${(e as Error).message.slice(0, 120)}`; }
  }
  return out;
}

export async function runAllPersonas(only?: string[]) {
  const out: Record<string, unknown> = {};
  for (const p of PERSONAS) out[p.id] = await runPersona(p, only);
  return out;
}
