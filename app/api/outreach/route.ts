// Contact finder → Verifier → Strategist → Writer for the next account without contacts.
// Its own cron, half an hour after Scout, because one account takes about 90 seconds.
import { runOutreach } from "@/lib/outreach";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ outreach: await runOutreach(1) });
}
