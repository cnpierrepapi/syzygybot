// Contact finder → Verifier → Strategist → Writer for the next account without contacts, then the
// Sequencer schedules whatever the Writer drafted.
// Its own cron, half an hour after Scout, because one account takes about 90 seconds.
import { runOutreach } from "@/lib/outreach";
import { runSequencer } from "@/lib/sequencer";
import { withLock } from "@/lib/lock";
import { runDealCheck } from "@/lib/dealcheck";
import { syncAll } from "@/lib/crm";
import { runInward } from "@/lib/inward";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  // Each step after the first only starts with room left before the 300s limit; skipped steps wait for the next cron.
  const t0 = Date.now(), room = (s: number) => (Date.now() - t0) / 1000 < s;
  const late = { skipped: "out of time" };
  return Response.json(await withLock("outreach", 290, async () => {
    // Backlog and two-week rechecks of theses with messages still waiting to go.
    const deals = await runDealCheck(3);
    const outreach = room(120) ? await runOutreach(1) : late;
    // Brands that claimed their page and switched sending on: drafts for anyone newly confirmed.
    const inward = room(200) ? await runInward(3) : late;
    const sequencer = room(240) ? await runSequencer(6) : late;
    // Brands that connected a CRM get whatever is new about the companies that need them.
    return { deals, outreach, inward, sequencer, crm: room(260) ? await syncAll() : late };
  }));
}
