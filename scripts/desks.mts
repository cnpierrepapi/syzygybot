// npm run desks                      -> run every persona's desks once (what the hourly cron does)
// npm run desks -- <persona id> [desk,desk]   -> one persona, optionally only some desks
import { PERSONAS, persona } from "../lib/personas";
import { runAllPersonas, runPersona } from "../lib/desks/run";
// npm run desks -- reclear [persona]          -> re-run Clearance on stored requests
import { reclear } from "../lib/desks/common";
const [id, only] = process.argv.slice(2);
if (id === "reclear") { console.log(await reclear({ persona: only })); process.exit(0); }
const desks = only?.split(",");
if (!id) console.log(await runAllPersonas(desks));
else { const p = persona(id); if (!p) { console.log(`no persona "${id}"; one of ${PERSONAS.map(x => x.id).join(", ")}`); process.exit(1); } console.log(await runPersona(p, desks)); }
