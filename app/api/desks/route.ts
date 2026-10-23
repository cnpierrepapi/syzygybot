// The desks' cron: one persona per run, whichever went longest without one. It gets a warm live run (the same run a
// visitor would start) unless one ran in the last 45 minutes, so an opened desk usually has a fresh run to show.
// Market Watch refreshes every 6 hours.
import { withLock } from "@/lib/lock";
import { sql } from "@/lib/db";
import { PERSONAS } from "@/lib/personas";
import { runPersonaWatch } from "@/lib/desks/run";
import { logAction } from "@/lib/actions";
import { execute, startOrJoin } from "@/lib/live/run";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const WATCH_EVERY_H = 6;  // Market Watch reads the news this often per persona
const WARM_EVERY_MIN = 45;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await withLock("desks", 790, async () => {
    const watched = (await sql()`select persona, max(created_at) at from watch_items group by persona`) as { persona: string; at: string }[];
    // Rotate on when each persona last got a run (logged below), not on when it last produced something.
    const runs = (await sql()`select detail->>'persona' persona, max(created_at) at from actions where kind = 'desk.run' group by 1`) as { persona: string; at: string }[];
    const when = (id: string) => +new Date(runs.find(x => x.persona === id)?.at ?? 0);
    const p = [...PERSONAS].sort((a, b) => when(a.id) - when(b.id))[0];
    const lastWatch = +new Date(watched.find(x => x.persona === p.id)?.at ?? 0);
    const watch = Date.now() - lastWatch > WATCH_EVERY_H * 3600e3;
    const [recent] = (await sql()`select id from runs where persona = ${p.id} and started_at > now() - make_interval(mins => ${WARM_EVERY_MIN})`) as { id: string }[];
    const r = recent ? null : await startOrJoin(p.id, "warm");
    if (r?.id && r.fresh) await execute(r.id);
    const ran = [...(r?.fresh ? ["live run"] : []), ...(watch ? ["watch"] : [])];
    const result = { run: r?.id ?? recent?.id ?? null, ...(watch ? await runPersonaWatch(p) : {}) };
    await logAction({ agent: "scout", kind: "desk.run", summary: `Desk run for ${p.title}.`, detail: { persona: p.id, ran, result } });
    return { persona: p.id, ran, result };
  }));
}
