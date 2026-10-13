// npm run accounts [-- N]  -> qualify the N best unqualified pairs
import { runAccounts } from "../lib/accounts";
for (const r of await runAccounts(Number(process.argv[2] ?? 2)))
  console.log(`${r.chosen} (passed on ${r.passed})  more partners: ${r.partners.join(", ")}  /account/${r.accountId}`);
