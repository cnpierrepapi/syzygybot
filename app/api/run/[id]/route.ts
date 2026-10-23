// One live run as the desk board polls it.
import { snapshot } from "@/lib/live/run";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const s = await snapshot(id);
  if (!s) return Response.json({ error: "no such run" }, { status: 404 });
  return Response.json(s, { headers: { "cache-control": "no-store" } });
}
