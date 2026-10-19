import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Logo } from "../../components/visuals";
import { DESKS, PERSONAS, desksFor, persona, type DeskId } from "@/lib/personas";
import { DESK_COOKIE, decide, requests, rulesOf, saveRules, underRules, watchItems, workspace, type Request } from "@/lib/desk";
import { RULE_LABEL, type Rules } from "@/lib/clearance";
import { sql } from "@/lib/db";
import { maskEmail } from "@/lib/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ persona: string }> }): Promise<Metadata> {
  const p = persona((await params).persona);
  return { title: p ? `${p.title} · desk` : "Desk", robots: { index: false, follow: true } };
}

const ACTION_LABEL: Record<string, string> = {
  email: "Email", letter: "Letter", hold_request: "Hold request", sponsor_pitch: "Sponsor pitch",
  ambassador_pitch: "Ambassador pitch", podcast_pitch: "Ad-sales pitch", crm_push: "CRM export",
};

async function ws() {
  return workspace((await cookies()).get(DESK_COOKIE)?.value);
}

async function act(fd: FormData) {
  "use server";
  const w = await ws();
  const back = `/desk/${String(fd.get("persona"))}`;
  if (!w) redirect("/desk");
  const decision = String(fd.get("decision")) as "approved" | "rejected" | "held";
  const subject = fd.get("subject"), body = fd.get("body");
  const r = await decide(w, String(fd.get("id")), decision, String(fd.get("reason") ?? "").trim().slice(0, 300) || null,
    subject != null && body != null ? { subject: String(subject).slice(0, 200), body: String(body).slice(0, 3000) } : null);
  const jar = await cookies();
  if (!r.ok) jar.set("syz_desk_flash", r.why.slice(0, 280), { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60, path: "/desk" });
  revalidatePath(back);
  redirect(`${back}${fd.get("desk") ? `?desk=${fd.get("desk")}` : ""}#r-${fd.get("id")}`);
}

async function rules(fd: FormData) {
  "use server";
  const w = await ws();
  if (!w) redirect("/desk");
  const next = Object.fromEntries((Object.keys(RULE_LABEL) as (keyof Rules)[]).map(k => [k, fd.get(k) === "on"])) as Partial<Rules>;
  await saveRules(w, next);
  redirect(`/desk/${String(fd.get("persona"))}#rules`);
}

const initials = (n?: string | null) => n ? n.split(/\s+/).map(x => x[0]).join(". ") + "." : null;

function Card({ r, personaId, rulesOn, showPersona, desk, first }: { r: Request; personaId: string; rulesOn: Rules; showPersona: boolean; desk?: string; first: boolean }) {
  const c = underRules(r.clearance, rulesOn);
  const m = r.evidence.match;
  const msg = r.edited ?? r.preview;
  const held = c.status === "hold";
  const decided = r.decision;
  return (
    <article id={`r-${r.id}`} className={`panel req${held ? " req-held" : ""}${decided ? " req-done" : ""}`}>
      <header className="req-top">
        <span className="chip"><i style={{ background: "#ffb020" }} />{DESKS[r.desk]?.label ?? r.desk}</span>
        <span className="chip">{ACTION_LABEL[r.action] ?? r.action} · {r.target.channel === "email" ? "email" : "letter"}</span>
        {showPersona && <span className="chip">{persona(r.persona)?.title ?? r.persona}</span>}
        <span className={`clear-badge ${held ? "hold" : "pass"}`}>{held ? "HELD BY CLEARANCE" : "CLEARED"}</span>
      </header>
      <div className="req-main">
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 18, lineHeight: 1.25 }}>{r.title}</h3>
          <p className="req-to">
            {r.action === "crm_push" ? <>To your CRM · HubSpot and Salesforce connectors built, not connected in this demo</> : <>
            To {r.target.person ? `${initials(r.target.person)} at ` : ""}{r.target.org}
            {r.target.address ? <> · <span className="mono">{maskEmail(r.target.address)}</span></> : <> · by post</>}
            {" · "}{r.target.country}</>}
          </p>
        </div>
        {m && (
          <div className="req-score" title="SYZYGY's own match score, out of 100">
            <b>{m.score}</b><span>our match</span>
            {m.qloo ? <em className="qloo-yes">Qloo confirms {m.qloo.toward.toFixed(2)} / {m.qloo.back.toFixed(2)}</em>
              : <em className="qloo-no">{m.strength} · not measured by Qloo yet</em>}
          </div>
        )}
      </div>
      <details className="req-msg" open={first && !decided}>
        <summary>{msg.subject || "(no subject)"}</summary>
        <pre>{msg.body}</pre>
      </details>
      <div className="req-cols">
        <div>
          <p className="eyebrow" style={{ marginBottom: 6 }}>Why</p>
          <ul className="facts">{r.evidence.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </div>
        <div>
          <p className="eyebrow" style={{ marginBottom: 6 }}>Clearance record</p>
          {/* Held rules stay in view; the passes fold into one line you can open. */}
          <ul className="rules">
            {c.checks.filter(x => !x.pass).map((x, i) => <li key={i} className="no"><b>HOLD</b> {x.label}<span>{x.note}</span></li>)}
          </ul>
          <details className="rules-more">
            <summary>{c.checks.filter(x => x.pass).length} of {c.checks.length} rules pass{c.off.length ? `, ${c.off.length} switched off` : ""}</summary>
            <ul className="rules">
              {c.checks.filter(x => x.pass).map((x, i) => <li key={i} className="ok"><b>PASS</b> {x.label}<span>{x.note}</span></li>)}
              {c.off.map((x, i) => <li key={`off${i}`} className="off"><b>OFF</b> {x.label}<span>Rule switched off in this workspace.</span></li>)}
            </ul>
          </details>
        </div>
      </div>
      {decided ? (
        <footer className="req-done-line">
          <b>{decided === "approved" ? "Approved" : decided === "rejected" ? "Rejected" : "On hold"}</b>
          {r.reason ? ` · "${r.reason}"` : ""}
          {r.outcome && (r.outcome as { did?: string }).did ? ` · ${(r.outcome as { did: string }).did} Simulated: nothing was sent.` : ""}
          <form action={act} style={{ display: "inline" }}>
            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="persona" value={personaId} /><input type="hidden" name="decision" value="held" />
            {desk && <input type="hidden" name="desk" value={desk} />}
            {decided !== "held" && <button className="linkish" type="submit">Undo, put it back on hold</button>}
          </form>
        </footer>
      ) : (
        <footer className="req-actions">
          <form action={act}>
            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="persona" value={personaId} /><input type="hidden" name="decision" value="approved" />
            {desk && <input type="hidden" name="desk" value={desk} />}
            {r.action === "crm_push"
              ? <button className="btn" type="button" disabled title="No CRM is connected to this workspace yet">Connect HubSpot or Salesforce to enable</button>
              : <button className="btn" type="submit" disabled={held} title={held ? "Clearance is holding this one" : undefined}>Approve</button>}
          </form>
          <form action={act}>
            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="persona" value={personaId} /><input type="hidden" name="decision" value="held" />
            {desk && <input type="hidden" name="desk" value={desk} />}
            <button className="btn quiet" type="submit">Hold</button>
          </form>
          <details className="inline-form">
            <summary className="btn quiet">Edit</summary>
            <form action={act} className="edit-form">
              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="persona" value={personaId} /><input type="hidden" name="decision" value="held" />
              {desk && <input type="hidden" name="desk" value={desk} />}
              <label className="field">Subject<input name="subject" defaultValue={msg.subject} /></label>
              <label className="field">Message<textarea name="body" rows={9} defaultValue={msg.body} /></label>
              <button className="btn" type="submit">Save and re-check</button>
            </form>
          </details>
          <details className="inline-form">
            <summary className="btn quiet warn">Reject</summary>
            <form action={act} className="edit-form">
              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="persona" value={personaId} /><input type="hidden" name="decision" value="rejected" />
              {desk && <input type="hidden" name="desk" value={desk} />}
              <label className="field">Why? The desk reads this before it writes again.<input name="reason" required maxLength={300} placeholder="e.g. wrong room size, we never pitch beer" /></label>
              <button className="btn warn" type="submit">Reject it</button>
            </form>
          </details>
        </footer>
      )}
    </article>
  );
}

export default async function Desk({ params, searchParams }: { params: Promise<{ persona: string }>; searchParams: Promise<{ desk?: string }> }) {
  const { persona: id } = await params;
  const { desk } = await searchParams;
  const p = persona(id);
  if (!p) notFound();
  const w = await ws();
  // A shared link to a desk opens one for the visitor (the cookie can only be set in a route).
  if (!w) redirect(`/desk/open?persona=${p.id}`);
  const jar = await cookies();
  const flash = jar.get("syz_desk_flash")?.value;
  const isClearance = p.role === "clearance";
  const rulesOn = rulesOf(w);
  const all = await requests(isClearance ? "all" : p.id, w.id);
  const desks = desksFor(p).filter(d => d !== "watch" && d !== "clearance");
  const shown = all.filter(r => !desk || r.desk === desk);
  const status = (r: Request) => underRules(r.clearance, rulesOn).status;
  const pending = shown.filter(r => !r.decision || r.decision === "held");
  const order = (r: Request) => (r.decision && r.decision !== "held" ? 2 : isClearance ? (status(r) === "hold" ? 0 : 1) : status(r) === "hold" ? 1 : 0);
  const sorted = [...shown].sort((a, b) => order(a) - order(b) || +new Date(b.created_at) - +new Date(a.created_at));
  const heldCount = pending.filter(r => status(r) === "hold").length;
  const news = await watchItems(p.id, 8);
  const log = (await sql()`select a.summary, a.agent, a.created_at from actions a
    where a.detail->>'persona' = ${p.id} or (a.detail->>'workspace' = ${w.id})
    order by a.created_at desc limit 14`) as { summary: string; agent: string; created_at: string }[];
  const counts = Object.fromEntries(desks.map(d => [d, all.filter(r => r.desk === d && (!r.decision || r.decision === "held")).length]));

  return (
    <main className="wrap desk desk-mode">
      <nav className="nav">
        <Logo />
        <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <a className="crumb" href="/desk">Switch desk</a>
          <a className="crumb" href="/">Live floor</a>
        </span>
      </nav>

      <a href="#queue" className="notif panel" aria-label={`${pending.length} permission requests waiting`}>
        <span className="bell" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 16h15.4L18 12.6V9a6 6 0 0 0-6-6Zm-2 15a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          {pending.length > 0 && <i>{pending.length}</i>}
        </span>
        <span>
          <b>{pending.length} {pending.length === 1 ? "request" : "requests"} waiting for you</b>
          <span className="notif-sub">{heldCount ? `${heldCount} held by Clearance, ` : ""}{pending.length - heldCount} ready to approve</span>
        </span>
        <span className="notif-go">Review →</span>
      </a>

      {flash && <p className="panel" style={{ padding: "10px 14px", borderColor: "#ff808088", color: "#ffb4b4" }}>{flash}</p>}

      <header className="desk-head">
        <div>
          <p className="eyebrow">{p.demo ? "Demo desk" : p.judge ? `Written for ${p.judge}` : "Desk"} · simulated persona</p>
          <h1 style={{ fontSize: "clamp(26px, 3.4vw, 38px)", lineHeight: 1.08 }}>{p.title}</h1>
          <p style={{ color: "var(--dim)", margin: "8px 0 0", maxWidth: 720 }}>{p.who} {p.forWhom}</p>
        </div>
      </header>

      <div className="desk-tabs" role="tablist">
        <a role="tab" aria-selected={!desk} className={!desk ? "on" : ""} href={`/desk/${p.id}`}>All <span>{pending.length}</span></a>
        {desks.map(d => <a key={d} role="tab" aria-selected={desk === d} className={desk === d ? "on" : ""} href={`/desk/${p.id}?desk=${d}`}>{DESKS[d].label} <span>{counts[d]}</span></a>)}
        {isClearance && <a href="#rules">Rules</a>}
        <a href="#watch">Market Watch <span>{news.length}</span></a>
      </div>

      <div className="desk-grid">
        <section id="queue" style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {desk && <p className="hint" style={{ margin: 0 }}>{DESKS[desk as DeskId]?.blurb}</p>}
          {!sorted.length && <div className="panel" style={{ padding: 22, color: "var(--dim)" }}>Nothing here yet. The desks run every hour; new requests land at the top.</div>}
          {sorted.map((r, i) => <Card key={r.id} r={r} personaId={p.id} rulesOn={rulesOn} showPersona={isClearance} desk={desk} first={i === 0} />)}
        </section>

        <aside style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {isClearance && (
            <form id="rules" action={rules} className="panel" style={{ padding: 18 }}>
              <input type="hidden" name="persona" value={p.id} />
              <p className="eyebrow">Your rules</p>
              <p style={{ color: "var(--dim)", fontSize: 13.5, marginTop: 0 }}>Every desk&apos;s drafts pass these before anyone sees them. Switch one off and the cards re-check against what&apos;s left.</p>
              <div style={{ display: "grid", gap: 8 }}>
                {(Object.keys(RULE_LABEL) as (keyof Rules)[]).map(k => (
                  <label key={k} className="rule-toggle"><input type="checkbox" name={k} defaultChecked={rulesOn[k]} /> {RULE_LABEL[k]}</label>
                ))}
              </div>
              <button className="btn" type="submit" style={{ marginTop: 12 }}>Save rules</button>
            </form>
          )}
          <section id="watch" className="panel" style={{ padding: 18 }}>
            <p className="eyebrow"><span className="live-dot" style={{ marginRight: 8, width: 6, height: 6 }} />Market Watch</p>
            {!news.length && <p style={{ color: "var(--dim)", fontSize: 13.5 }}>Reading the news for this desk. First items land within the hour.</p>}
            <ul className="watch">
              {news.map(n => (
                <li key={n.id}>
                  <a href={n.url} target="_blank" rel="noopener nofollow">{n.headline}</a>
                  <span className="watch-meta">{n.source}{n.published ? ` · ${new Date(n.published).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>
                  <p>{n.why}</p>
                  {n.move && <p className="watch-move"><b>Move:</b> {n.move}</p>}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel" style={{ padding: 18 }}>
            <p className="eyebrow">What the agents did</p>
            <ul className="log">
              {log.map((l, i) => <li key={i}><span>{new Date(l.created_at).toISOString().slice(11, 16)}</span>{l.summary}</li>)}
            </ul>
          </section>
        </aside>
      </div>
      <p className="hint" style={{ marginTop: 26 }}>
        Demo desks are simulated personas. Addresses are masked. Approving runs the action as a simulation and nothing is sent.
        Our match score is SYZYGY&apos;s own number out of 100; where Qloo has measured the pair, its taste data confirms it.
      </p>
      <p className="hint" style={{ marginTop: 6 }}>Other desks: {PERSONAS.filter(x => x.id !== p.id).map((x, i) => <span key={x.id}>{i ? " · " : ""}<a href={`/desk/${x.id}`}>{x.title}</a></span>)}</p>
    </main>
  );
}
