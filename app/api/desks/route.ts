// The desks' cron: one persona per run, whichever went longest without one, so every dashboard keeps filling without
// one run having to cover all seven. A live persona gets a warm live run (the same run a visitor would start), unless one
// ran in the last 45 minutes. Other personas still run their desks the old way. Market Watch refreshes every 6 hours.
import { withLock } from "@/lib/lock";
import { sql } from "@/lib/db";
import { PERSONAS } from "@/lib/personas";
import { runPersona } from "@/lib/desks/run";
import { logAction } from "@/lib/actions";
import { isLive } from "@/lib/live/plans";
import { execute, startOrJoin } from "@/lib/live/run";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const FULL = 12;          // open requests a persona can hold before its desks wait for decisions
const WATCH_EVERY_H = 6;  // Market Watch reads the news this often per persona
const WARM_EVERY_MIN = 45;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await withLock("desks", 790, async () => {
    const last = (await sql()`select persona, max(created_at) at, count(*) filter (where not exists
        (select 1 from request_decisions d where d.request_id = r.id))::int open
      from permission_requests r group by persona`) as { persona: string; at: string; open: number }[];
    const watched = (await sql()`select persona, max(created_at) at from watch_items group by persona`) as { persona: string; at: string }[];
    // Rotate on when each persona last got a run (logged below), not on when it last produced something.
    const runs = (await sql()`select detail->>'persona' persona, max(created_at) at from actions where kind = 'desk.run' group by 1`) as { persona: string; at: string }[];
    const when = (id: string) => +new Date(runs.find(x => x.persona === id)?.at ?? 0);
    const p = [...PERSONAS].sort((a, b) => when(a.id) - when(b.id))[0];
    const open = last.find(x => x.persona === p.id)?.open ?? 0;
    const lastWatch = +new Date(watched.find(x => x.persona === p.id)?.at ?? 0);
    const watch = Date.now() - lastWatch > WATCH_EVERY_H * 3600e3 ? ["watch"] : [];
    let result: unknown;
    let ran: string[];
    if (isLive(p.id)) {
      const [recent] = (await sql()`select id from runs where persona = ${p.id} and started_at > now() - make_interval(mins => ${WARM_EVERY_MIN})`) as { id: string }[];
      const r = recent ? null : await startOrJoin(p.id, "warm");
      if (r?.id && r.fresh) await execute(r.id);
      ran = [...(r?.fresh ? ["live run"] : []), ...watch];
      result = { run: r?.id ?? recent?.id ?? null, ...(watch.length ? { watch: await runPersona(p, watch) } : {}) };
    } else {
      ran = [...(open < FULL ? ["tour", "sponsorship", "talent", "venue", "podcast", "sales"] : []), ...watch];
      result = ran.length ? await runPersona(p, ran) : "queue full, news fresh";
    }
    await logAction({ agent: "watch", kind: "desk.run", summary: `Desk run for ${p.title}.`, detail: { persona: p.id, ran, result } });
    return { persona: p.id, ran, result };
  }));
}
