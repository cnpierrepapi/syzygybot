// npm run desks                      -> refresh every persona's Market Watch once (pitching desks run live: npm run live)
// npm run desks -- <persona id>      -> one persona's Market Watch
// npm run desks -- reclear [persona] -> re-run Clearance on stored requests
import { PERSONAS, persona } from "../lib/personas";
import { runAllWatch, runPersonaWatch } from "../lib/desks/run";
import { reclear } from "../lib/desks/common";
const [id, only] = process.argv.slice(2);
if (id === "reclear") { console.log(await reclear({ persona: only })); process.exit(0); }
if (!id) console.log(await runAllWatch());
else { const p = persona(id); if (!p) { console.log(`no persona "${id}"; one of ${PERSONAS.map(x => x.id).join(", ")}`); process.exit(1); } console.log(await runPersonaWatch(p)); }
