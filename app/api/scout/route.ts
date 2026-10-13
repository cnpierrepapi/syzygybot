// Runs one Scout pass, then qualifies the best new pairs. Called by Vercel Cron (Bearer CRON_SECRET) or by hand with the same header.
import { runScout } from "@/lib/scout";
import { fillSlugs } from "@/lib/slug";
import { withLock } from "@/lib/lock";
import { runAccounts } from "@/lib/accounts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await withLock("scout", 290, async () => {
    const results = await runScout();
    const accounts = await runAccounts(2);
    await fillSlugs();
    return { results, accounts };
  }));
}
