// Opening a live desk calls this: it joins the run going now for that persona, or starts one and keeps working on it
// after the response (the board polls /api/run/<id> for the steps).
import { after } from "next/server";
import { execute, startOrJoin } from "@/lib/live/run";
import { isLive } from "@/lib/live/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: Request) {
  const { persona, again } = (await req.json().catch(() => ({}))) as { persona?: string; again?: boolean };
  if (!persona || !isLive(persona)) return Response.json({ error: "not a live desk" }, { status: 400 });
  const r = await startOrJoin(persona, again ? "again" : "visit");
  if (r.id && r.fresh) after(() => execute(r.id!));
  return Response.json(r, { headers: { "cache-control": "no-store" } });
}
