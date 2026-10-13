// Public, read-only: what the floor polls for new agent actions and funnel counts.
import { feed, funnel } from "@/lib/floor";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const after = new URL(req.url).searchParams.get("after") ?? undefined;
  if (after && Number.isNaN(Date.parse(after))) return Response.json({ error: "bad after" }, { status: 400 });
  const [items, counts] = await Promise.all([feed(40, after), funnel()]);
  return Response.json({ items, funnel: counts }, { headers: { "cache-control": "no-store" } });
}
