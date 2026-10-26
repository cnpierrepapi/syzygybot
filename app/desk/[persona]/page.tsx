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
import { outboundFor, type Outbound } from "@/lib/outbound";
import { deskDomains, ownedDesks, ownerOf, pendingCode, sendCode, verifyCode } from "@/lib/owners";
import RealApprove from "./RealApprove";
import { addAnchor, anchorsOf, removeAnchor } from "@/lib/live/anchors";

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

// Proving the desk is yours: a code to an email at the desk's own domain. After that, Approve sends for real.
async function owner(fd: FormData) {
  "use server";
  const w = await ws();
  const id = String(fd.get("persona")), back = `/desk/${id}`;
  if (!w) redirect("/desk");
  const code = fd.get("code");
  const r = code != null ? await verifyCode(w.id, id, String(code)) : await sendCode(w.id, id, String(fd.get("email") ?? ""));
  if (!r.ok) (await cookies()).set("syz_desk_flash", r.why.slice(0, 280), { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60, path: "/desk" });
  revalidatePath(back);
  redirect(`${back}#owner`);
}

// A business desk's anchors: only its verified owner may swap one, since every score on the desk is read through them.
async function anchor(fd: FormData) {
  "use server";
  const w = await ws();
  const id = String(fd.get("persona")), back = `/desk/${id}`;
  if (!w) redirect("/desk");
  const jar = await cookies();
  if (!(await ownerOf(w.id, id))) {
    jar.set("syz_desk_flash", "Only the desk's verified owner can change its anchors.", { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60, path: "/desk" });
    redirect(`${back}#anchors`);
  }
  if (fd.get("rerun")) redirect(`${back}?again=1#board`);
  const gone = fd.get("remove"), name = fd.get("add");
  const r = gone ? await removeAnchor(id, String(gone)) : await addAnchor(id, String(name ?? ""));
  if (!r.ok) jar.set("syz_desk_flash", r.why.slice(0, 280), { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60, path: "/desk" });
  revalidatePath(back);
  redirect(`${back}#anchors`);
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
  scout: "Scout", checker: "Deal check", rival_check: "Rival check", qualifier: "Numbers", numbers: "Numbers", contact_finder: "Contact finder", verifier: "Verifier",
  strategist: "Writer", writer: "Writer", sequencer: "Sequencer", inbox: "Inbox agent", clearance: "Clearance", router: "Sequencer",
  sponsor: "Scout", talent: "Scout", venue: "Scout", podcast: "Scout", watch: "Scout",
};

const OUT_STATUS: Record<string, string> = { draft: "Not sent yet", queued: "Approved, waiting for its sending window", sent: "Sent", held: "Held at the gates", failed: "Failed", cancelled: "Cancelled", bounced: "Bounced" };

function Card({ r, personaId, rulesOn, showPersona, desk, first, steps, owned, out: real0 }: { r: Request; personaId: string; rulesOn: Rules; showPersona: boolean; desk?: string; first: boolean; steps: Step[]; owned: boolean; out?: Outbound }) {
  const c = underRules(r.clearance, rulesOn);
  const m = r.evidence.match;
  const msg = r.edited ?? r.preview;
  const held = c.status === "hold";
  const decided = r.decision;
  // The Bad Bunny demo's pitches desk: an approved email really goes out (letters stay simulated).
  // On a desk this browser verified as its own, approving sends for real, exactly as the card reads.
  const liveCard = owned && r.ref_table === "run_cards" && (r.target.channel === "email" || r.target.channel === "letter");
  const real = owned && !!persona(r.persona)?.realSends && r.desk === "pitches" && r.target.channel === "email";
  const out = (r.outcome ?? {}) as { did?: string; simulated?: boolean; queued?: boolean };
  const sentForReal = out.simulated === false && !out.queued;
  return (
    <article id={`r-${r.id}`} className={`panel req${held ? " req-held" : ""}${decided ? " req-done" : ""}`}>
      <header className="req-top">
        <span className="chip"><i style={{ background: "#a86400" }} />{DESKS[r.desk]?.label ?? r.desk}</span>
        <span className="chip">{(() => { const a = ACTION_LABEL[r.action] ?? r.action, ch = r.target.channel === "email" ? "email" : "letter"; return a.toLowerCase() === ch ? a : `${a} · ${ch}`; })()}</span>
        {showPersona && <span className="chip">{persona(r.persona)?.title ?? r.persona}</span>}
        {(real || liveCard) && <span className="chip" style={{ borderColor: "#1f8a5b88", color: "#1f8a5b" }}>{r.target.channel === "letter" ? "REAL LETTER" : "REAL EMAIL"}</span>}
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
              {m.qloo.via && <em className="qloo-no" title={`Measured against ${m.qloo.via.join(", ")}`}>Measured against {m.qloo.via.length} anchors</em>}
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
      {liveCard && real0 && real0.status !== "draft" && (
        <p className="hint" style={{ margin: "0 0 0 14px", color: real0.status === "held" || real0.status === "failed" ? "#b4432f" : "#1f8a5b" }}>
          Real {real0.channel}: {OUT_STATUS[real0.status] ?? real0.status}{real0.status === "held" ? `. ${(real0.detail?.held ?? []).map((h: { note: string }) => h.note).join(" ")}` : ""}
        </p>
      )}
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
              : liveCard || real
                ? <RealApprove channel={r.target.channel} org={r.target.org} sender={persona(r.persona)?.title ?? "this desk"} disabled={held} title={held ? "Clearance is holding this one" : undefined} />
                : <button className="btn" type="submit" disabled={held} title={held ? "Clearance is holding this one" : undefined}>Approve</button>}
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

export default async function Desk({ params, searchParams }: { params: Promise<{ persona: string }>; searchParams: Promise<{ desk?: string; again?: string }> }) {
  const { persona: id } = await params;
  const { desk, again } = await searchParams;
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
  const owned = await ownedDesks(w.id);
  const outs = owned.size ? await outboundFor(all.filter(r => owned.has(r.persona)).map(r => r.id)) : new Map<string, Outbound>();
  const mine = isClearance ? null : await ownerOf(w.id, p.id);
  const codeTo = isClearance || mine ? null : await pendingCode(w.id, p.id);
  const domains = isClearance || mine ? [] : await deskDomains(p.id);
  const anchors = custom?.type === "business" ? await anchorsOf(p.id) : null;
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
            <p className="eyebrow">{p.demo ? "Demo desk · simulated persona" : p.judge ? `Written for ${p.judge} · simulated persona` : anchors ? "Your desk · set up from its website, read through Qloo" : "Your desk · set up from Qloo"}</p>
            <h1>{p.title}</h1>
            <p>{p.who} {p.forWhom}</p>
            {custom && !anchors && <p className="hint" style={{ margin: "8px 0 0" }}>
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

      {!isClearance && (
        <section id="owner" className="panel" style={{ padding: "12px 16px", marginBottom: 12, borderColor: mine ? "#1f8a5b88" : undefined }}>
          {mine ? (
            <p style={{ margin: 0 }}><b style={{ color: "#1f8a5b" }}>Live desk.</b> Approving a card here sends the real email or letter, as {p.title}. Verified by {maskEmail(mine.email)}.</p>
          ) : !domains.length ? (
            <p style={{ margin: 0, color: "var(--dim)" }}>Approvals here are simulations. This desk has no company domain on record yet, so it can&apos;t be switched to real sending.</p>
          ) : codeTo ? (
            <form action={owner} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="persona" value={p.id} />
              <span>We sent a code to {maskEmail(codeTo)}. Enter it to send for real from this desk.</span>
              <input name="code" inputMode="numeric" required placeholder="6-digit code" aria-label="Code" style={{ width: 120 }} />
              <button className="btn" type="submit">Verify</button>
            </form>
          ) : (
            <form action={owner} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="persona" value={p.id} />
              <span>Approvals here are simulations. Is this desk yours? Confirm with your email at {domains.join(" or ")} and Approve sends for real.</span>
              <input name="email" type="email" required placeholder={`you@${domains[0]}`} aria-label="Work email" style={{ minWidth: 220 }} />
              <button className="btn quiet" type="submit">Send me a code</button>
            </form>
          )}
        </section>
      )}

      {anchors && (
        <section id="anchors" className="panel" style={{ padding: "14px 16px", marginBottom: 12, display: "grid", gap: 10 }}>
          <div>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Anchors · how Qloo reads {p.subject}</p>
            <p style={{ margin: 0, color: "var(--dim)", fontSize: 14, maxWidth: 760 }}>
              Qloo has no record of {p.subject}, so the agents read its audience through these: things Qloo knows whose audience is
              the one {p.subject} sells to, picked from {custom?.site ? new URL(custom.site).hostname.replace(/^www\./, "") : "its site"}.
              Every score on this desk is Qloo&apos;s, measured both ways against them.
              {mine ? " Swap one and run the desk again." : " The desk's verified owner can swap them."}
            </p>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {anchors.map(a => (
              <li key={a.id} className="chip" title={a.why ?? undefined} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <b>{a.name}</b><span style={{ color: "var(--mute)" }}>{a.type.replace("_", " ")}</span>
                {mine && anchors.length > 2 && (
                  <form action={anchor} style={{ display: "inline" }}>
                    <input type="hidden" name="persona" value={p.id} /><input type="hidden" name="remove" value={a.id} />
                    <button type="submit" className="linkish" aria-label={`Remove ${a.name}`}>×</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {mine && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {anchors.length < 6 && (
                <form action={anchor} style={{ display: "flex", gap: 8 }}>
                  <input type="hidden" name="persona" value={p.id} />
                  <input name="add" required maxLength={60} placeholder="Add a podcast, brand, show or person" aria-label="Add an anchor" style={{ minWidth: 260 }} />
                  <button className="btn quiet" type="submit">Add</button>
                </form>
              )}
              <form action={anchor}>
                <input type="hidden" name="persona" value={p.id} /><input type="hidden" name="rerun" value="1" />
                <button className="btn" type="submit">Run it again with these anchors</button>
              </form>
            </div>
          )}
        </section>
      )}

      <div className="desk-tabs" role="tablist">
        <a role="tab" aria-selected={!desk} className={!desk ? "on" : ""} href={`/desk/${p.id}`}>All <span>{pending.length}</span></a>
        {desks.map(d => <a key={d} role="tab" aria-selected={desk === d} className={desk === d ? "on" : ""} href={`/desk/${p.id}?desk=${d}`}>{DESKS[d].label} <span>{counts[d]}</span></a>)}
        {isClearance && <a href="#rules">Rules</a>}
      </div>

      {desk && <p className="hint" style={{ margin: "0 0 12px" }}>{DESKS[desk as DeskId]?.blurb}</p>}
      {isLive(p.id) && <div id="board"><LiveBoard persona={p.id} review={planOf(p.id)?.kind === "review"} again={!!again && !!mine} /></div>}

      <section id="queue" style={{ display: "grid", gap: 10, marginBottom: 22 }}>
        <h2 style={{ fontSize: 20 }}>Requests</h2>
        {!sorted.length && <div className="panel" style={{ padding: 22, color: "var(--dim)" }}>Nothing here yet. New requests land here first as the agents file them.</div>}
        <Carousel>
          {sorted.map((r, i) => <Card key={r.id} r={r} personaId={p.id} rulesOn={rulesOn} showPersona={isClearance} desk={desk} first={i === 0} steps={stepsOf.get(r.id) ?? []} owned={owned.has(r.persona)} out={outs.get(r.id)} />)}
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
        Demo desks are simulated personas. Addresses are masked. Your approval runs the action as a simulation and nothing is sent.
        Once you&apos;ve shown a desk is yours (a code to your work email), approving there sends the real email or letter in the desk&apos;s name.
        The score is Qloo&apos;s, out of 1: how much each audience leans toward the other, and the weaker of the two counts.
        Our own number, out of 100, is a rough estimate. It only leads when Qloo hasn&apos;t measured the pair.
      </p>
      <p className="hint" style={{ marginTop: 6 }}>Other desks: {PERSONAS.filter(x => x.id !== p.id).map((x, i) => <span key={x.id}>{i ? " · " : ""}<a href={`/desk/${x.id}`}>{x.title}</a></span>)}</p>
    </main>
  );
}
