// npm run verifier:recheck [-- N]  -> apply the departure rules to people already on file
import { recheckDepartures } from "../lib/contacts";
console.log(await recheckDepartures(Number(process.argv[2] ?? 500)));
