// Switched off 27 Oct with Gemini (lib/llm.ts): this agent loop ran on model calls and Google Search grounding.
// Desks now play back the agents' finished runs (lib/live/run.ts), so nothing here has work to do.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ off: true });
}
