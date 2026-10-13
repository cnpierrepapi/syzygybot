// Reports which services are configured. Never returns secret values. The live checks (a real Qloo
// call and a database round trip) only run with the cron secret, so nobody can spend the Qloo quota
// by refreshing this page.
import { sql } from "@/lib/db";
import { search } from "@/lib/qloo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const out: Record<string, string> = {
    qloo: process.env.QLOO_API_KEY ? "configured" : "unconfigured",
    db: process.env.DATABASE_URL ? "configured" : "unconfigured",
    llm: process.env.GOOGLE_VERTEX_CREDENTIALS_B64 ? "configured (vertex gemini)" : "unconfigured: theses use the plain-numbers fallback",
  };
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json(out);

  if (process.env.QLOO_API_KEY) {
    try { out.qloo = (await search("A24", "brand", 1)).length ? "ok" : "empty"; }
    catch (e) { out.qloo = `error: ${(e as Error).message.slice(0, 80)}`; }
  }
  if (process.env.DATABASE_URL) {
    try { await sql()`select 1`; out.db = "ok"; }
    catch { out.db = "error"; }
  }
  return Response.json(out);
}
