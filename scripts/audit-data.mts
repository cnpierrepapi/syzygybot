// npm run audit:data   -> checks what the desks have filed and how the runs went, without changing anything.
import { sql } from "../lib/db";
import { SENSITIVE } from "../lib/match";
import { WEAK_SOURCE } from "../lib/contacts";

type R = { id: string; persona: string; title: string; action: string; target: any; preview: { subject: string; body: string }; evidence: any; clearance: any; run_id: string | null; decided: boolean };
const reqs = (await sql()`select r.id, r.persona, r.title, r.action, r.target, r.preview, r.evidence, r.clearance, r.run_id,
  exists (select 1 from request_decisions d where d.request_id = r.id) decided from permission_requests r`) as R[];
const open = reqs.filter(r => !r.decided);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const all = (r: R) => `${r.preview?.subject ?? ""}\n${r.preview?.body ?? ""}`;
const tastes = (b: string) => [...b.matchAll(/(shared (audience )?(tastes?|preferences?|interests?)|audiences? (share|like|love|lean)|tastes include|overlap in|interests? in)[^.]*\./gi)].map(m => m[0]).join(" ");
const out: Record<string, unknown> = {};
const byPersona = (xs: R[]) => xs.reduce((o: Record<string, number>, r) => (o[r.persona] = (o[r.persona] ?? 0) + 1, o), {});
out.requests = { total: reqs.length, open: open.length, live: reqs.filter(r => r.run_id).length, open_by_persona: byPersona(open), held_open: byPersona(open.filter(r => r.clearance?.status === "hold")) };
out.em_dash = open.filter(r => /—/.test(all(r))).map(r => r.title);
out.no_ai_disclosure = open.filter(r => r.action !== "crm_push" && !/\bai\b|artificial intelligence/i.test((r.preview?.body ?? "").slice(0, 260))).map(r => r.title);
out.percentages = open.filter(r => r.action !== "crm_push" && /%|\bper ?cent\b/i.test(all(r))).map(r => r.title);
out.sensitive_tastes = open.filter(r => SENSITIVE.test(tastes(r.preview?.body ?? ""))).map(r => `${r.title}: "${SENSITIVE.exec(tastes(r.preview.body))![0]}"`);
out.sensitive_facts = open.filter(r => (r.evidence?.facts ?? []).some((f: string) => /shared audience tastes/i.test(f) && SENSITIVE.test(f))).map(r => r.title);
out.weak_person_source = open.filter(r => r.target?.personSource && WEAK_SOURCE.test(host(r.target.personSource))).map(r => `${r.title} (${host(r.target.personSource)})`);
out.over_170_words = open.filter(r => r.action !== "crm_push" && (r.preview?.body ?? "").split(/\s+/).length > 170).map(r => r.title);
out.no_qloo_score = open.filter(r => r.evidence?.match && !r.evidence.match.qloo).map(r => r.title);
const titles = open.reduce((m: Map<string, number>, r) => m.set(`${r.persona}|${r.title}`, (m.get(`${r.persona}|${r.title}`) ?? 0) + 1), new Map());
out.duplicate_titles = [...titles].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
out.meeting_ask = open.filter(r => /\b(call|meeting|zoom|calendar|time slot|20 minutes|15 minutes)\b/i.test(r.preview?.body ?? "")).map(r => r.title);
out.poses_as_qloo = open.filter(r => /(we at qloo|i work (at|for) qloo|on behalf of qloo|our qloo|qloo team here)/i.test(all(r))).map(r => r.title);
out.runs_today = await sql()`select persona, status, count(*)::int n, round(avg(extract(epoch from finished_at - started_at)))::int avg_s, sum(qloo_calls)::int qloo
  from runs where started_at > now() - interval '1 day' group by 1, 2 order by 1, 2`;
out.stuck_runs = await sql()`select id, persona, started_at from runs where status = 'running' and started_at < now() - interval '15 minutes'`;
out.failed_runs_today = await sql()`select persona, error, count(*)::int n from runs where status = 'failed' and started_at > now() - interval '1 day' group by 1, 2`;
out.dropped_cards_today = await sql()`select c.detail->>'why' why, count(*)::int n from run_cards c join runs r on r.id = c.run_id
  where c.status = 'dropped' and r.started_at > now() - interval '1 day' group by 1 order by 2 desc`;
out.custom_desks = await sql()`select id, name, type, created_at from custom_desks order by created_at`;
out.spend_today = await sql()`select round(sum(cost_usd)::numeric, 2) usd, sum(qloo_calls)::int qloo from runs where started_at > now() - interval '1 day'`;
out.mail_sent = await sql()`select count(*)::int n, max(sent_at) last from touches where sent_at is not null`.catch(e => String(e));
console.log(JSON.stringify(out, null, 1));
