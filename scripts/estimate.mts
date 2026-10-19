// npm run estimate -- dry   -> how many unmeasured brand x talent pairs clear our match-score bar (no writes)
// npm run estimate          -> add them to the queue as SYZYGY estimates (no Qloo calls)
import { estimatePairs } from "../lib/estimate";
console.log(await estimatePairs({ dryRun: process.argv[2] === "dry" }));
