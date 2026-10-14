// Contact finder → Verifier → Strategist → Writer for the next account without contacts, then the
// Sequencer schedules whatever the Writer drafted.
// Its own cron, half an hour after Scout, because one account takes about 90 seconds.
import { runOutreach } from "@/lib/outreach";
import { runSequencer } from "@/lib/sequencer";
import { withLock } from "@/lib/lock";
import { runDealCheck } from "@/lib/dealcheck";
import { syncAll } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await withLock("outreach", 290, async () => {
    // Backlog and two-week rechecks of theses with messages still waiting to go.
    const deals = await runDealCheck(3);
    const outreach = await runOutreach(1);
    const sequencer = await runSequencer(6);
    // Brands that connected a CRM get whatever is new about the companies that need them.
    return { deals, outreach, sequencer, crm: await syncAll() };
  }));
}
