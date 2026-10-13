// Reports which services are configured and reachable. Never returns secret values.
import { sql } from "@/lib/db";
import { search } from "@/lib/qloo";

export const dynamic = "force-dynamic";

export async function GET() {
  const out: Record<string, string> = {};

  if (!process.env.QLOO_API_KEY) out.qloo = "unconfigured";
  else {
    try { out.qloo = (await search("A24", "brand", 1)).length ? "ok" : "empty"; }
    catch (e) { out.qloo = `error: ${(e as Error).message.slice(0, 80)}`; }
  }

  if (!process.env.DATABASE_URL) out.db = "unconfigured";
  else {
    try { await sql()`select 1`; out.db = "ok"; }
    catch { out.db = "error"; }
  }

  out.llm = process.env.GOOGLE_VERTEX_CREDENTIALS_B64 ? "configured (vertex gemini)" : "unconfigured: theses use the plain-numbers fallback";
  return Response.json(out);
}
