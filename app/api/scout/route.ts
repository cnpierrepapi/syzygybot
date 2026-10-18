// One full loop, every hour: Scout → Deal check → Qualifier → Numbers, then the account it just qualified goes
// straight on to Contact finder → Verifier → Strategist → Writer → Sequencer, so the floor shows the
// whole chain in one cascade. If the pass qualified nobody new, the oldest waiting account goes instead.
// The :30 cron (/api/outreach) keeps working the backlog in between.
// Called by Vercel Cron (Bearer CRON_SECRET) or by hand with the same header.
import { runScout } from "@/lib/scout";
import { fillSlugs } from "@/lib/slug";
import { withLock } from "@/lib/lock";
import { runAccounts } from "@/lib/accounts";
import { runDealCheck } from "@/lib/dealcheck";
import { runOutreach } from "@/lib/outreach";
import { runSequencer } from "@/lib/sequencer";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await withLock("scout", 790, async () => {
    const results = await runScout();
    // Nothing becomes an account until the Deal check has looked for an existing partnership.
    const deals = await runDealCheck(6);
    const accounts = await runAccounts(2);
    await fillSlugs();
    const fresh = accounts.find(a => a.isNew);
    const chain = await withLock("outreach", 500, async () => {
      const outreach = await runOutreach(1, fresh?.accountId);
      return { outreach, sequencer: await runSequencer(6) };
    });
    return { results, deals, accounts, chain };
  }));
}
