// npm run sequence [-- N]  -> schedule the next N first messages and write their follow-ups
import { runSequencer } from "../lib/sequencer";
console.log(JSON.stringify(await runSequencer(Number(process.argv[2] ?? 10)), null, 2));
