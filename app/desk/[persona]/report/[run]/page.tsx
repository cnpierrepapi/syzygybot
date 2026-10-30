// A live run's report: rebuilt from that run alone (its Qloo reads, the brands it measured, every card's steps), opened in
// its own tab and downloadable as one HTML file. Addresses stay masked, as on the desk.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { loadPersona } from "@/lib/personas";
import { snapshot, spearman } from "@/lib/live/run";
import { colsFor } from "@/lib/live/plans";
import type { Insights } from "@/lib/live/qx";
import { maskEmail } from "@/lib/ui";
import { Logo } from "../../../../components/visuals";
import SaveButton from "./SaveButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Run report", robots: { index: false, follow: false } };


const AGENT: Record<string, string> = {
  scout: "Scout", checker: "Deal check", numbers: "Numbers", contact_finder: "Contact finder", writer: "Writer", clearance: "Clearance",
  sponsor: "Sponsor", talent: "Talent", podcast: "Podcast", venue: "Venue", sequencer: "Sequencer", verifier: "Verifier",
};
const t = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
const f2 = (x: number | null) => (x == null ? "n/a" : x.toFixed(2));

type Check = { a_name: string; b_name: string; ours: number; qloo_toward: number | null; qloo_back: number | null };
type Req = { id: string; title: string; target: { person?: string | null; role?: string | null; address?: string | null; channel: string; personSource?: string | null; postal?: string | null };
  preview: { subject: string; body: string }; clearance: { status: string; checks: { label: string; pass: boolean; note: string }[] } };

export default async function Report({ params }: { params: Promise<{ persona: string; run: string }> }) {
  const { persona: pid, run } = await params;
  const p = await loadPersona(pid);
  if (!p || !/^[0-9a-f-]{36}$/i.test(run)) notFound();
  const s = await snapshot(run);
  const COLS = colsFor(p.id), review = COLS[0] !== "Spotted";
  if (!s || s.persona !== p.id) notFound();
  // A run played back reports the measurements its original run took.
  const [{ insights, src }] = (await sql()`select insights, coalesce(replay_of, id) src from runs where id = ${run}`) as { insights: Partial<Insights>; src: string }[];
  const checks = (await sql()`select a_name, b_name, ours, qloo_toward, qloo_back from estimate_checks where run_id = ${src} and source = 'run' order by a_name, ours desc`) as Check[];
  const reqs = (await sql()`select id, title, target, preview, clearance from permission_requests where id = any(${s.cards.map(c => c.request_id).filter(Boolean)})`) as Req[];
  const reqOf = new Map(reqs.map(r => [r.id, r]));
  // How close our score is to Qloo, on this run's brands and on every brand any run has measured so far.
  const two = (c: Check) => (c.qloo_toward != null && c.qloo_back != null ? Math.min(c.qloo_toward, c.qloo_back) : null);
  const lanes = [...new Set(checks.map(c => c.a_name))].map(a => {
    const xs = checks.filter(c => c.a_name === a && two(c) != null);
    const byQloo = [...xs].sort((x, y) => two(y)! - two(x)!).slice(0, 5).map(x => x.b_name);
    const byUs = [...xs].sort((x, y) => y.ours - x.ours).slice(0, 5).map(x => x.b_name);
    return { a, n: xs.length, rho: spearman(xs.map(x => x.ours), xs.map(x => two(x)!)), top5: byQloo.filter(b => byUs.includes(b)).length };
  });
  const measured = (await sql()`select source, ours, qloo_toward, qloo_back from estimate_checks where qloo_toward is not null and qloo_back is not null`) as (Check & { source: string })[];
  const rhoOf = (xs: Check[]) => spearman(xs.map(c => c.ours), xs.map(c => Math.min(c.qloo_toward!, c.qloo_back!)));
  const runs = measured.filter(c => c.source === "run"), all = measured;
  const allRho = rhoOf(all), runRho = rhoOf(runs);
  const done = s.cards.filter(c => c.status === "done").length;
  const when = new Date(s.started_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const secs = s.finished_at ? Math.round((+new Date(s.finished_at) - +new Date(s.started_at)) / 1000) : null;

  return (
    <main className="wrap report">
      <nav className="nav no-print">
        <Logo />
        <SaveButton name={`syzygy-${p.id}-${s.started_at.slice(0, 16).replace(/[:T]/g, "-")}.html`} />
      </nav>
      <header className="report-head">
        <p className="eyebrow">Live run report · {when} UTC</p>
        <h1>{p.title}</h1>
        <p className="report-sub">{p.who} {p.forWhom}</p>
        <div className="report-kpis">
          <span><b>{done}</b> {review ? "checked again" : "waiting for approval"}</span>
          <span><b>{s.cards.length - done}</b> dropped or unfinished</span>
          <span><b>{s.qloo_calls}</b> Qloo calls</span>
          <span><b>{secs == null ? "running" : `${Math.floor(secs / 60)}m ${secs % 60}s`}</b> run time</span>
        </div>
        {s.status !== "done" && <p className="report-warn">{s.status === "running" ? "This run is still going. Reload for the rest." : `This run stopped early${s.error ? `: ${s.error}` : ""}.`}</p>}
      </header>

      {(insights.people?.length || insights.audiences?.length) ? <section className="report-sec">
        <h2>What Qloo said about this audience today</h2>
        <ul className="report-facts">
          {insights.people?.length ? <li>Their fans also follow <b>{insights.people.slice(0, 6).join(", ")}</b>.</li> : null}
          {insights.shows?.length ? <li>Shows they over-index on: {insights.shows.slice(0, 5).join(", ")}.</li> : null}
          {insights.podcasts?.length ? <li>Podcasts they over-index on: {insights.podcasts.slice(0, 5).join(", ")}.</li> : null}
          {insights.audiences?.length ? <li>Interest groups: {insights.audiences.map(a => `${a.name} (${f2(a.affinity)})`).join(", ")}.</li> : null}
          {insights.local?.length ? <li>In {insights.city}, they lean toward {insights.local.map(l => l.name).join(", ")}.</li> : null}
        </ul>
        <p className="hint">Read live from Qloo&apos;s taste data during this run. Interest groups are Qloo audiences; groups that describe who people are (communities, beliefs, politics) are left out on purpose.</p>
      </section> : null}

      {checks.length > 0 && <section className="report-sec">
        <h2>Qloo&apos;s score, and how close our estimate came</h2>
        <p>Qloo measured every brand the agents looked at, live and both ways: how much this audience leans toward the brand, and how much the brand&apos;s audience leans back. The weaker of the two is the score, out of 1, and it picked the cards. Our own number, out of 100, is a rough estimate from patterns in older Qloo data. It sits next to Qloo&apos;s so you can see how far off it is.</p>
        <ul className="report-facts">
          {lanes.map(l => <li key={l.a}><b>{l.a}</b>: {l.n} brands. Our estimate&apos;s rank correlation with Qloo is {l.rho ?? "n/a"}, and it got {l.top5} of Qloo&apos;s top 5.</li>)}
          <li>Every brand any live run has measured so far ({runs.length}): rank correlation {runRho ?? "n/a"}.</li>
          <li>Every pair Qloo has measured for us, runs and the earlier corpus together ({all.length.toLocaleString("en-US")}): rank correlation {allRho ?? "n/a"}. 1 means we rank exactly like Qloo, 0 means no relation.</li>
        </ul>
        <table className="report-table">
          <thead><tr><th>Audience</th><th>Brand</th><th>Qloo score, of 1</th><th>Toward</th><th>Back</th><th>Our rough estimate</th></tr></thead>
          <tbody>{[...checks].sort((x, y) => x.a_name.localeCompare(y.a_name) || (two(y) ?? -1) - (two(x) ?? -1)).map(c => <tr key={c.a_name + c.b_name}><td>{c.a_name}</td><td>{c.b_name}</td><td><b>{f2(two(c))}</b></td><td>{f2(c.qloo_toward)}</td><td>{f2(c.qloo_back)}</td><td>{c.ours}/100</td></tr>)}</tbody>
        </table>
      </section>}

      <section className="report-sec">
        <h2>The cards</h2>
        {s.cards.map(c => {
          const r = c.request_id ? reqOf.get(c.request_id) : undefined;
          return (
            <article key={c.id} className="report-card">
              <h3>{c.title}</h3>
              <p className="report-sub">{c.status === "done" ? (review ? "Checked again" : "Waiting for approval") : c.status === "dropped" ? "Dropped" : "Unfinished"}{r ? ` · ${r.target.channel === "email" ? `email to ${r.target.person ? `${r.target.person} via ` : ""}${maskEmail(r.target.address ?? null)}` : `letter${r.target.person ? ` to ${r.target.person}` : ""}`} · Clearance ${r.clearance.status === "pass" ? "cleared" : "held"}` : ""}</p>
              <ol className="report-steps">
                {c.steps.map((st, i) => <li key={i}><span>{t(st.at)}</span><em>{st.col != null ? COLS[st.col] : ""}</em><b>{AGENT[st.agent] ?? st.agent}</b> {st.summary}</li>)}
              </ol>
              {r?.target.personSource && <p className="hint">Person confirmed on <a href={r.target.personSource} target="_blank" rel="noopener nofollow">{r.target.personSource}</a></p>}
              {r && <details><summary>The draft: {r.preview.subject}</summary><pre>{r.preview.body}</pre></details>}
              {r && r.clearance.checks.some(x => !x.pass) && <p className="report-warn">Held: {r.clearance.checks.filter(x => !x.pass).map(x => `${x.label} (${x.note})`).join("; ")}</p>}
            </article>
          );
        })}
      </section>

      <section className="report-sec">
        <h2>Run log</h2>
        <ol className="report-steps">{s.log.map((st, i) => <li key={i}><span>{t(st.at)}</span><b>{AGENT[st.agent] ?? st.agent}</b> {st.summary}</li>)}</ol>
        <p className="hint">Times are UTC. Nothing in this run was sent: {review ? "every card went back to its own desk for the owner's sign-off." : "every card waits in Your approval on the desk."} Scores are Qloo&apos;s, 0 to 1. Numbers out of 100 are SYZYGY&apos;s rough estimate.</p>
      </section>
    </main>
  );
}
