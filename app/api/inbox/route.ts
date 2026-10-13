// Inbox agent entry point. Until the mailbox exists, replies arrive here by hand and are marked simulated.
import { handleReply } from "@/lib/inbox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const { touch_id, body, simulated = true } = (await req.json()) as { touch_id?: string; body?: string; simulated?: boolean };
  if (!touch_id || !/^[0-9a-f-]{36}$/.test(touch_id) || !body) return Response.json({ error: "touch_id and body required" }, { status: 400 });
  return Response.json(await handleReply(touch_id, body.slice(0, 5000), simulated));
}
