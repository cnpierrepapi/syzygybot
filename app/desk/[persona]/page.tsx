import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Logo } from "../../components/visuals";
import { DESKS, PERSONAS, customOf, desksFor, loadPersona, persona, type DeskId } from "@/lib/personas";
import { DESK_COOKIE, decide, requests, rulesOf, saveRules, underRules, watchItems, workspace, type Request } from "@/lib/desk";
import { RULE_LABEL, type Rules } from "@/lib/clearance";
import { sql } from "@/lib/db";
import { maskEmail } from "@/lib/ui";
import { board, type Step } from "@/lib/board";
import SkyCard from "../../components/SkyCard";
import LiveBoard from "./LiveBoard";
import Carousel from "./Carousel";
import { isLive, planOf } from "@/lib/live/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ persona: string }> }): Promise<Metadata> {
  const p = await loadPersona((await params).persona);
  return { title: p ? `${p.title} · desk` : "Desk", robots: { index: false, follow: true } };
}

const ACTION_LABEL: Record<string, string> = {
  email: "Email", letter: "Letter", hold_request: "Hold request", sponsor_pitch: "Sponsor pitch",
  ambassador_pitch: "Ambassador pitch", podcast_pitch: "Ad-sales pitch", crm_push: "CRM export",
  collab_pitch: "Collab pitch", booking_pitch: "Booking pitch",
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

const STEP_AGENT: Record<string, string> = {
  scout: "Scout", checker: "Deal check", qualifier: "Qualifier", numbers: "Numbers", contact_finder: "Contact finder", verifier: "Verifier",
  strategist: "Strategist", writer: "Writer", sequencer: "Sequencer", inbox: "Inbox agent", clearance: "Clearance", router: "Router",
  sponsor: "Sponsor", talent: "Talent", venue: "Venue", podcast: "Podcast",
};

function Card({ r, personaId, rulesOn, showPersona, desk, first, steps }: { r: Request; personaId: string; rulesOn: Rules; showPersona: boolean; desk?: string; first: boolean; steps: Step[] }) {
  const c = underRules(r.clearance, rulesOn);
  const m = r.evidence.match;
  const msg = r.edited ?? r.preview;
  const held = c.status === "hold";
  const decided = r.decision;
  // The Bad Bunny demo's pitches desk: an approved email really goes out (letters stay simulated).
  const real = !!persona(r.persona)?.realSends && r.desk === "pitches" && r.target.channel === "email";
  const out = (r.outcome ?? {}) as { did?: string; simulated?: boolean; queued?: boolean };
  const sentForReal = out.simulated === false && !out.queued;
  return (
    <article id={`r-${r.id}`} className={`panel req${held ? " req-held" : ""}${decided ? " req-done" : ""}`}>
      <header className="req-top">
        <span className="chip"><i style={{ background: "#a86400" }} />{DESKS[r.desk]?.label ?? r.desk}</span>
        <span className="chip">{(() => { const a = ACTION_LABEL[r.action] ?? r.action, ch = r.target.channel === "email" ? "email" : "letter"; return a.toLowerCase() === ch ? a : `${a} · ${ch}`; })()}</span>
        {showPersona && <span className="chip">{persona(r.persona)?.title ?? r.persona}</span>}
        {real && <span className="chip" style={{ borderColor: "#1f8a5b88", color: "#1f8a5b" }}>REAL EMAIL</span>}
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
          // Qloo's two-way number is the score. Ours is a rough estimate, shown small, and leads only when Qloo hasn't measured the pair.
          m.qloo ? (
            <div className="req-score" title="Qloo's taste data, measured both ways. The score is the weaker of the two.">
              <b>{Math.min(m.qloo.toward, m.qloo.back).toFixed(2)}<small>/1</small></b><span>Qloo, both ways</span>
              <em className="qloo-yes">{m.qloo.toward.toFixed(2)} toward · {m.qloo.back.toFixed(2)} back</em>
              <em className="qloo-no">Our rough estimate {m.score}/100</em>
            </div>
          ) : (
            <div className="req-score" title="SYZYGY's own estimate. Rough: it often disagrees with Qloo.">
              <b>{m.score}<small>/100</small></b><span>our estimate</span>
              <em className="qloo-no">Rough. Qloo hasn&apos;t measured this pair yet.</em>
            </div>
          )
        )}
      </div>
      <details className="req-msg" open={first && !decided}>
        <summary>{msg.subject || "(no subject)"}</summary>
        <pre>{msg.body}</pre>
      </details>
      {steps.length > 0 && (
        <details className="req-msg">
          <summary>How the agents got here · {steps.length} steps</summary>
          <ul className="req-steps" style={{ padding: "0 14px 14px" }}>
            {steps.map((s, i) => (
              <li key={i}><span>{new Date(s.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} {new Date(s.at).toISOString().slice(11, 16)}</span>
                <span><b>{STEP_AGENT[s.agent] ?? s.agent}</b> {s.summary}</span></li>
            ))}
          </ul>
        </details>
      )}
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
          {out.did ? ` · ${out.did}${out.simulated === false ? "" : " Simulated: nothing was sent."}` : ""}
          <form action={act} style={{ display: "inline" }}>
            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="persona" value={personaId} /><input type="hidden" name="decision" value="held" />
            {desk && <input type="hidden" name="desk" value={desk} />}
            {decided !== "held" && !sentForReal && <button className="linkish" type="submit">Undo, put it back on hold</button>}
          </form>
        </footer>
      ) : (
        <footer className="req-actions">
          <form action={act}>
            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="persona" value={personaId} /><input type="hidden" name="decision" value="approved" />
            {desk && <input type="hidden" name="desk" value={desk} />}
            {r.action === "crm_push"
              ? <button className="btn" type="button" disabled title="No CRM is connected to this workspace yet">Connect HubSpot or Salesforce to enable</button>
              : <button className="btn" type="submit" disabled={held} title={held ? "Clearance is holding this one" : real ? "This sends a real email" : undefined}>{real ? "Approve and send" : "Approve"}</button>}
          </form>
          <form action={act}>
            <input type="hidden" name="id" value={r.id} /><input type="hidden" name="persona" value={personaId} /><input type="hidden" name="decision" value="held" />
            {desk && <input type="hidden" name="desk" value={desk} />}
            <button className="btn quiet" type="submit">Hold</button>
          </form>
          {!real && <details className="inline-form">
            <summary className="btn quiet">Edit</summary>
            <form action={act} className="edit-form">
              <input type="hidden" name="id" value={r.id} /><input type="hidden" name="persona" value={personaId} /><input type="hidden" name="decision" value="held" />
              {desk && <input type="hidden" name="desk" value={desk} />}
              <label className="field">Subject<input name="subject" defaultValue={msg.subject} /></label>
              <label className="field">Message<textarea name="body" rows={9} defaultValue={msg.body} /></label>
              <button className="btn" type="submit">Save and re-check</button>
            </form>
          </details>}
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
  const p = await loadPersona(id);
  if (!p) notFound();
  const custom = customOf(p.id);
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
  // The banner and the All tab count the whole desk, whichever tab is open.
  const pending = all.filter(r => !r.decision || r.decision === "held");
  const order = (r: Request) => (r.decision && r.decision !== "held" ? 2 : isClearance ? (status(r) === "hold" ? 0 : 1) : status(r) === "hold" ? 1 : 0);
  const sorted = [...shown].sort((a, b) => order(a) - order(b) || +new Date(b.created_at) - +new Date(a.created_at));
  const heldCount = pending.filter(r => status(r) === "hold").length;
  const news = await watchItems(p.id, 8);
  const log = (await sql()`select a.summary, a.agent, a.created_at from actions a
    where a.detail->>'persona' = ${p.id} or (a.detail->>'workspace' = ${w.id})
    order by a.created_at desc limit 14`) as { summary: string; agent: string; created_at: string }[];
  const counts = Object.fromEntries(desks.map(d => [d, all.filter(r => r.desk === d && (!r.decision || r.decision === "held")).length]));
  const cards = await board(sorted);
  const stepsOf = new Map(cards.map(c => [c.id, c.steps]));
  const sentCount = cards.filter(c => c.col >= 7).length;

  return (
    <main className="wrap desk desk-mode">
      <nav className="nav">
        <Logo />
        <span style={{ display: "flex", gap: 18, alignItems: "center" }}>
          <a className="crumb" href="/desk">Switch desk</a>
          <a className="crumb" href="/">Live floor</a>
        </span>
      </nav>

      <SkyCard>
        <div className="desk-hero">
          <div>
            <p className="eyebrow">{p.demo ? "Demo desk · simulated persona" : p.judge ? `Written for ${p.judge} · simulated persona` : "Your desk · set up from Qloo"}</p>
            <h1>{p.title}</h1>
            <p>{p.who} {p.forWhom}</p>
            {custom && <p className="hint" style={{ margin: "8px 0 0" }}>
              Not the one you meant? <a href={`/desk?q=${encodeURIComponent(custom.name)}#yours`}>See Qloo&apos;s other matches</a>
            </p>}
          </div>
          <div className="desk-kpis">
            <a href="#queue"><b>{pending.length - heldCount}</b><small>waiting for you</small></a>
            <span><b>{heldCount}</b><small>held by Clearance</small></span>
            <span><b>{sentCount}</b><small>sent</small></span>
          </div>
        </div>
      </SkyCard>

      {flash && <p className="panel" style={{ padding: "10px 14px", borderColor: "#e5b8ae", color: "#b4432f" }}>{flash}</p>}

      <div className="desk-tabs" role="tablist">
        <a role="tab" aria-selected={!desk} className={!desk ? "on" : ""} href={`/desk/${p.id}`}>All <span>{pending.length}</span></a>
        {desks.map(d => <a key={d} role="tab" aria-selected={desk === d} className={desk === d ? "on" : ""} href={`/desk/${p.id}?desk=${d}`}>{DESKS[d].label} <span>{counts[d]}</span></a>)}
        {isClearance && <a href="#rules">Rules</a>}
      </div>

      {desk && <p className="hint" style={{ margin: "0 0 12px" }}>{DESKS[desk as DeskId]?.blurb}</p>}
      {isLive(p.id) && <LiveBoard persona={p.id} review={planOf(p.id)?.kind === "review"} />}

      <section id="queue" style={{ display: "grid", gap: 10, marginBottom: 22 }}>
        <h2 style={{ fontSize: 20 }}>Requests</h2>
        {!sorted.length && <div className="panel" style={{ padding: 22, color: "var(--dim)" }}>Nothing here yet. New requests land here first as the agents file them.</div>}
        <Carousel>
          {sorted.map((r, i) => <Card key={r.id} r={r} personaId={p.id} rulesOn={rulesOn} showPersona={isClearance} desk={desk} first={i === 0} steps={stepsOf.get(r.id) ?? []} />)}
        </Carousel>
      </section>

      <div className="desk-side">
        <aside style={{ display: "contents" }}>
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
          {p.news.length > 0 && <section id="watch" className="panel" style={{ padding: 18 }}>
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
          </section>}
          <section className="panel" style={{ padding: 18 }}>
            <p className="eyebrow">What the agents did</p>
            <ul className="log">
              {log.map((l, i) => <li key={i}><span>{new Date(l.created_at).toISOString().slice(11, 16)}</span>{l.summary}</li>)}
            </ul>
          </section>
        </aside>
      </div>
      <p className="hint" style={{ marginTop: 26 }}>
        Demo desks are simulated personas. Addresses are masked. Approving runs the action as a simulation and nothing is sent,
        except on the Bad Bunny desk&apos;s SYZYGY pitches, where an approved email really goes out.
        The score is Qloo&apos;s, out of 1: how much each audience leans toward the other, and the weaker of the two counts.
        Our own number, out of 100, is a rough estimate. It only leads when Qloo hasn&apos;t measured the pair.
      </p>
      <p className="hint" style={{ marginTop: 6 }}>Other desks: {PERSONAS.filter(x => x.id !== p.id).map((x, i) => <span key={x.id}>{i ? " · " : ""}<a href={`/desk/${x.id}`}>{x.title}</a></span>)}</p>
    </main>
  );
}
