// Deal check by hand: `npm run dealcheck` works the due list; `npm run dealcheck -- <limit>` checks more.
import { runDealCheck } from "../lib/dealcheck";
console.log(JSON.stringify(await runDealCheck(Number(process.argv[2] ?? 4)), null, 2));
