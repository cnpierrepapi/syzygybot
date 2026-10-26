import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin, signIn } from "@/lib/admin";
import { activity, agentsSeen, desk, desks, errors } from "@/lib/ops";
import { loadPersona } from "@/lib/personas";
import { Logo } from "../components/visuals";

// The operator's page: sign in with the key, then the logs, what went wrong, and every desk. Kept out of search results.
export const metadata: Metadata = { title: "Operator", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const safeNext = (n: string | undefined) => (n && /^\/[a-z0-9/_-]*$/i.test(n) ? n : "/admin");
const when = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "never");
const ago = (d: string | null) => (d ? Math.round((Date.now() - +new Date(d)) / 60000) : null);
const VERCEL_LOGS = "https://vercel.com/nchibulls40-3390s-projects/syzygybot/logs";

type Search = { next?: string; bad?: string; tab?: string; agent?: string; desk?: string; q?: string; id?: string };

function SignIn({ to, bad }: { to: string; bad?: string }) {
  return (
    <section className="panel fade-up" style={{ padding: 32, maxWidth: 520, marginTop: 8 }}>
      <form action={async (fd: FormData) => {
        "use server";
        const ok = await signIn(String(fd.get("key") ?? ""));
        redirect(ok ? to : `/admin?bad=1&next=${encodeURIComponent(to)}`);
      }} style={{ display: "grid", gap: 14 }}>
        <h1 style={{ fontFamily: "var(--display)", fontSize: 26, margin: 0 }}>Operator sign-in</h1>
        <p style={{ color: "var(--mute)", margin: 0, fontSize: 14 }}>Logs, errors and every desk, for the person who runs SYZYGY. Everyone else can read every public page without it.</p>
        <input name="key" type="password" autoComplete="current-password" aria-label="Operator key"
          style={{ padding: "10px 12px", background: "transparent", color: "inherit", border: "1px solid var(--line)", borderRadius: 8, fontFamily: "var(--mono)" }} />
        {bad && <span style={{ color: "#b4432f", fontSize: 13 }}>That key didn&apos;t match.</span>}
        <button type="submit" className="band" style={{ cursor: "pointer", padding: "10px 18px", fontSize: 14, justifySelf: "start" }}>Sign in</button>
      </form>
    </section>
  );
}

const cell = { padding: "6px 10px", borderBottom: "1px solid var(--line)", verticalAlign: "top" as const, fontSize: 13 };
const mono = { ...cell, fontFamily: "var(--mono)", fontSize: 11.5, whiteSpace: "nowrap" as const, color: "var(--mute)" };
const bad = { color: "#b4432f" };

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <p className="hint" style={{ margin: "6px 0 0" }}>Nothing here.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="report-table" style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{head.map(h => <th key={h} style={{ ...cell, fontSize: 11.5, color: "var(--mute)" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={j === 0 ? mono : cell}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

async function Activity({ s }: { s: Search }) {
  const [acts, agents] = await Promise.all([activity({ agent: s.agent, desk: s.desk, q: s.q }), agentsSeen()]);
  return (
    <section className="panel" style={{ padding: 18, display: "grid", gap: 12 }}>
      <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="hidden" name="tab" value="activity" />
        <select name="agent" defaultValue={s.agent ?? ""} aria-label="Agent">
          <option value="">Every agent</option>{agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input name="desk" defaultValue={s.desk ?? ""} placeholder="desk id, e.g. bad-bunny-touring" aria-label="Desk" style={{ minWidth: 220 }} />
        <input name="q" defaultValue={s.q ?? ""} placeholder="a word in the step" aria-label="Search" />
        <button className="btn quiet" type="submit">Filter</button>
      </form>
      <Table head={["When (UTC)", "Agent", "Kind", "Desk", "What happened"]} rows={acts.map(a => [
        when(a.at), a.agent, <span key="k" className="mono" style={{ fontSize: 11.5 }}>{a.kind}</span>,
        a.persona ? <a key="d" href={`/admin?tab=desks&id=${a.persona}`}>{a.persona}</a> : "",
        <span key="s" style={/fail|error|dropped/.test(a.kind) ? bad : undefined}>{a.summary}{a.cost ? <span className="hint"> · ${a.cost.toFixed(3)}</span> : null}</span>,
      ])} />
      <p className="hint" style={{ margin: 0 }}>Latest {acts.length} steps. Every agent step writes one row; if it isn&apos;t here, it didn&apos;t happen.</p>
    </section>
  );
}

async function Errors() {
  const e = await errors();
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Crons</p>
        <Table head={["Last seen (UTC)", "Job", "State"]} rows={e.crons.map(c => {
          const m = ago(c.last);
          const late = c.lateAfterMin != null && (m == null || m > c.lateAfterMin);
          return [when(c.last), c.name, <span key="s" style={late ? bad : undefined}>{m == null ? "never ran" : `${m} min ago${late ? ", late" : ""}`}</span>];
        })} />
        <p className="hint" style={{ margin: "8px 0 0" }}>Function crashes and timeouts are in <a href={VERCEL_LOGS} target="_blank" rel="noopener">Vercel&apos;s runtime logs</a>.</p>
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Failed runs · last 7 days</p>
        <Table head={["Started (UTC)", "Desk", "Trigger", "Error"]} rows={e.failedRuns.map(r => [
          when(r.started_at), <a key="d" href={`/admin?tab=desks&id=${r.persona}`}>{r.persona}</a>, r.trigger, <span key="e" style={bad}>{r.error ?? "no message"}</span>,
        ])} />
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Real sends held, failed or bounced</p>
        <Table head={["Filed (UTC)", "Desk", "To", "Status", "Why"]} rows={e.sends.map(o => [
          when(o.created_at), <a key="d" href={`/admin?tab=desks&id=${o.persona}`}>{o.persona}</a>, `${o.company} · ${o.channel}`,
          <span key="s" style={bad}>{o.status}</span>,
          ((o.detail?.held as { note: string }[] | undefined)?.map(h => h.note).join(" ") || String(o.detail?.error ?? o.detail?.why ?? "")) || "no reason recorded",
        ])} />
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Cards dropped · last 7 days, by reason</p>
        <Table head={["Latest (UTC)", "Reason", "Cards", "e.g."]} rows={e.dropped.map(d => [when(d.last), d.why, d.n, d.orgs.filter(Boolean).join(", ")])} />
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Failures the agents logged · last 7 days</p>
        <Table head={["When (UTC)", "Agent", "Desk", "What happened"]} rows={e.logged.map(a => [
          when(a.at), a.agent, a.persona ?? "", <span key="s" style={bad}>{a.summary}</span>,
        ])} />
      </section>
    </div>
  );
}

async function Desks({ q }: { q?: string }) {
  const rows = await desks(q);
  return (
    <section className="panel" style={{ padding: 18, display: "grid", gap: 12 }}>
      <form method="get" style={{ display: "flex", gap: 8 }}>
        <input type="hidden" name="tab" value="desks" />
        <input name="q" defaultValue={q ?? ""} placeholder="Find a desk: Bad Bunny, onenept, my-…" aria-label="Find a desk" style={{ minWidth: 280 }} />
        <button className="btn quiet" type="submit">Find</button>
      </form>
      <Table head={["Last run (UTC)", "Desk", "Kind", "Runs", "Cards", "Approved", "Rejected", "Sent", "Held", "Replies", "Owners"]} rows={rows.map(d => [
        <span key="w" style={d.lastStatus === "failed" ? bad : undefined}>{when(d.lastRun)}{d.lastStatus === "running" ? " · running" : ""}</span>,
        <a key="t" href={`/admin?tab=desks&id=${d.id}`}>{d.title}</a>, d.kind, d.runs, d.cards, d.approved, d.rejected,
        d.sent, <span key="h" style={d.held ? bad : undefined}>{d.held}</span>, d.replies, d.owners,
      ])} />
    </section>
  );
}

async function Desk({ id }: { id: string }) {
  const p = await loadPersona(id);
  if (!p) return <p className="panel" style={{ padding: 18 }}>No desk called {id}.</p>;
  const d = await desk(id);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Desk</p>
        <h2 style={{ fontSize: 22, margin: "0 0 4px" }}>{p.title}</h2>
        <p className="hint" style={{ margin: 0 }}>
          <a href={`/desk/${id}`}>Open the desk</a> · <a href={`/admin?tab=activity&desk=${id}`}>Its steps</a> · {d.owners.length
            ? `Verified by ${d.owners.map(o => `${o.email} (${when(o.verified_at)})`).join(", ")}`
            : "Nobody has verified this desk, so its approvals are simulations."}
        </p>
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Runs</p>
        <Table head={["Started (UTC)", "Trigger", "Status", "Filed", "Dropped", "Qloo calls", "Cost", "Error"]} rows={d.runs.map(r => [
          when(r.started_at), r.trigger, <span key="s" style={r.status === "failed" ? bad : undefined}>{r.status}</span>, r.filed, r.dropped,
          r.qloo_calls, `$${Number(r.cost_usd).toFixed(2)}`, r.error ? <span key="e" style={bad}>{r.error}</span> : "",
        ])} />
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Real sends</p>
        <Table head={["Filed (UTC)", "To", "Address", "Status", "Scheduled / sent"]} rows={d.sends.map(o => [
          when(o.created_at), `${o.company} · ${o.channel}`, o.to_address ?? "by post",
          <span key="s" style={/held|failed|bounced/.test(o.status) ? bad : undefined}>{o.status}</span>,
          o.sent_at ? `sent ${when(o.sent_at)}` : o.scheduled_for ? `due ${when(o.scheduled_for)}` : "",
        ])} />
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Replies</p>
        <Table head={["When (UTC)", "From", "Class", "Summary"]} rows={d.replies.map(r => [when(r.created_at), r.company, r.class, r.summary ?? ""])} />
      </section>
      <section className="panel" style={{ padding: 18 }}>
        <p className="eyebrow">Cards · newest 40</p>
        <Table head={["Filed (UTC)", "Card", "Channel", "Clearance", "Decisions (every workspace)"]} rows={d.cards.map(c => [
          when(c.created_at), <a key="t" href={`/desk/${id}#r-${c.id}`}>{c.title}</a>,
          `${c.channel ?? ""}${c.address ? ` · ${c.address}` : ""}`,
          <span key="c" style={c.clearance === "hold" ? bad : undefined}>{c.clearance}</span>,
          c.decisions.length ? c.decisions.map(x => `${x.decision}${x.reason ? ` ("${x.reason}")` : ""}`).join(", ") : "none yet",
        ])} />
      </section>
    </div>
  );
}

const TABS = [["activity", "Activity"], ["errors", "Errors"], ["desks", "Desk lookup"]] as const;

export default async function Admin({ searchParams }: { searchParams: Promise<Search> }) {
  const s = await searchParams;
  if (!(await isAdmin())) {
    return (
      <main className="wrap">
        <nav className="nav"><Logo /><span className="crumb">OPERATOR</span></nav>
        <SignIn to={safeNext(s.next)} bad={s.bad} />
      </main>
    );
  }
  const tab = s.id ? "desks" : TABS.some(([k]) => k === s.tab) ? s.tab! : "activity";
  return (
    <main className="wrap" style={{ maxWidth: 1200 }}>
      <nav className="nav"><Logo /><span className="crumb">OPERATOR</span></nav>
      <div className="desk-tabs" role="tablist" style={{ marginBottom: 12 }}>
        {TABS.map(([k, label]) => <a key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} href={`/admin?tab=${k}`}>{label}</a>)}
      </div>
      {tab === "activity" && <Activity s={s} />}
      {tab === "errors" && <Errors />}
      {tab === "desks" && (s.id ? <Desk id={s.id} /> : <Desks q={s.q} />)}
    </main>
  );
}
