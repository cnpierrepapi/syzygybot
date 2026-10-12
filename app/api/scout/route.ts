// Runs one Scout pass. Called by Vercel Cron (Bearer CRON_SECRET) or by hand with the same header.
import { runScout } from "@/lib/scout";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const results = await runScout();
  return Response.json({ results });
}
