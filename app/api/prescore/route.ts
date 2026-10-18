// The prescore sweep: scores every partner on each unswept seed's Qloo list into the queue Scout
// picks from. Its own cron so the sweep never slows the chained loop down.
// Called by Vercel Cron (Bearer CRON_SECRET) or by hand with the same header.
import { runPrescore } from "@/lib/prescore";
import { withLock } from "@/lib/lock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await withLock("prescore", 290, () => runPrescore(240_000)));
}
