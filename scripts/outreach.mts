// npm run outreach [-- N | -- <account id>]  -> Contact finder → Verifier → Strategist → Writer
import { runOutreach } from "../lib/outreach";
const arg = process.argv[2];
const isId = !!arg && /^[0-9a-f-]{36}$/.test(arg);
console.log(JSON.stringify(await runOutreach(isId ? 1 : Number(arg ?? 1), isId ? arg : undefined), null, 2));
