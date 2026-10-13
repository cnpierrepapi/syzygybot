// Contact finder → Verifier → Strategist → Writer for the next account without contacts, then the
// Sequencer schedules whatever the Writer drafted.
// Its own cron, half an hour after Scout, because one account takes about 90 seconds.
import { runOutreach } from "@/lib/outreach";
import { runSequencer } from "@/lib/sequencer";
import { withLock } from "@/lib/lock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await withLock("outreach", 290, async () => {
    const outreach = await runOutreach(1);
    return { outreach, sequencer: await runSequencer(6) };
  }));
}
