// Pushes every connected CRM's new records. Bearer CRON_SECRET (the :30 cron calls syncAll directly).
import { syncAll } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ crm: await syncAll() });
}
