// npm run loop  -> one full chained pass, same as the Scout cron: Scout → Deal check → … → Sequencer
import { runScout } from "../lib/scout";
import { runAccounts } from "../lib/accounts";
import { runDealCheck } from "../lib/dealcheck";
import { runOutreach } from "../lib/outreach";
import { runSequencer } from "../lib/sequencer";
import { fillSlugs } from "../lib/slug";
const t0 = Date.now(), lap = (s: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s  ${s}`);
const results = await runScout(); lap(`Scout: ${results.length} pairs (${results.map(r => `${r.b} ${r.band}`).join(", ")})`);
const deals = await runDealCheck(6); lap(`Deal check: ${JSON.stringify(deals).slice(0, 200)}`);
const accounts = await runAccounts(2); await fillSlugs(); lap(`Qualifier + Numbers: ${accounts.map(a => `${a.chosen}${a.isNew ? " (new)" : " (joined existing)"}`).join(", ") || "none"}`);
const fresh = accounts.find(a => a.isNew);
const outreach = await runOutreach(1, fresh?.accountId); lap(`Contact finder → Writer: ${JSON.stringify(outreach)}`);
const seq = await runSequencer(6); lap(`Sequencer: ${seq.length} scheduled`);
