// Podcast & Creator desk (agent: Podcast). Qloo's podcast data is thin in our corpus, so the show gets a look-alike profile
// and sponsors are ranked by our match score alone (Qloo confirmation comes once the quota resets).
import { runPatternTalent } from "./pattern";
import type { Persona } from "../personas";

export const runPodcast = (p: Persona, n = 4) => runPatternTalent(p, p.subject, n, "podcast");
