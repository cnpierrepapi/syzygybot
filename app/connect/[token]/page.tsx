import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { FocusStars } from "../../components/Sky";
import { PROVIDERS, syncConnection } from "@/lib/crm";
import { workspaceByToken } from "@/lib/claim";
import { setSendAs, signerOf } from "@/lib/inward";
import { handoffPath, STATUS } from "@/lib/handoff";
import { pathFor } from "@/lib/slug";
import { Logo } from "../../components/visuals";

// A brand's private workspace: whoever holds the link sees the playbook, switches sending on or off,
// picks up interested replies and connects a CRM. Never in search.
export const metadata: Metadata = { title: "Your workspace", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Conn = { id: string; provider: string; last_sync_at: string | null; last_error: string | null; created_at: string; records: number };
type Target = {
  id: string; slug: string | null; entity_id: string; name: string; band: string; score: number; deal_status: string;
  lean: string | null; back: string | null; angle: string | null; timing: string | null;
};
type Person = { id: string; entity_id: string; name: string | null; role: string; kind: string };
type Draft = { id: string; contact_id: string; subject: string | null; body: string; status: string; scheduled_for: string | null };

async function syncNow(formData: FormData) {
  "use server";
  const w = await workspaceByToken(String(formData.get("token")));
  if (!w) return;
  for (const c of (await sql()`select * from crm_connections where workspace_id = ${w.id}`) as Parameters<typeof syncConnection>[0][]) {
    await syncConnection(c).catch(async e => { await sql()`update crm_connections set last_error = ${String((e as Error).message).slice(0, 500)} where id = ${c.id}`; });
  }
  revalidatePath(`/connect/${formData.get("token")}`);
}

async function sending(formData: FormData) {
  "use server";
  const tok = String(formData.get("token"));
  const w = await workspaceByToken(tok);
  if (!w?.claimed_at) return;
  const on = formData.get("on") === "1";
  const signer = String(formData.get("signer") ?? "").trim().slice(0, 80) || null;
  const email = String(formData.get("email") ?? "").trim().slice(0, 120);
  await setSendAs(w, on, signer, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null);
  redirect(`/connect/${tok}#sending`);
}

export default async function Connect({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ connected?: string; error?: string; claimed?: string; demo?: string }> }) {
  const { token } = await params;
  const w = await workspaceByToken(token);
  if (!w) notFound();
  const q = await searchParams;
  const targets = (await sql()`
    select ac.id, ac.slug, ac.entity_id, e.name, p.band, p.score, p.deal_status,
      ac.evidence->'pull'->>'accountFansLikePartner' lean, ac.evidence->'pull'->>'partnerFansLikeAccount' back, pl.angle, pl.detail->>'timing' timing
    from accounts ac join entities e on e.qloo_id = ac.entity_id join pairs p on p.id = ac.pair_id
    left join lateral (select x.angle, x.detail from plans x join accounts y on y.id = x.account_id where y.entity_id = ac.entity_id order by x.created_at desc limit 1) pl on true
    where ac.passed_on = ${w.entity_id} and p.deal_status in ('clear','past') order by p.score desc`) as Target[];
  const people = (await sql()`
    select c.id, x.entity_id, c.name, c.role, c.kind from contacts c join accounts x on x.id = c.account_id
    where x.entity_id = any(${targets.map(t => t.entity_id)}) and c.role_status = 'confirmed' order by c.kind desc, c.created_at`) as Person[];
  const drafts = w.demo ? [] : (await sql()`
    select id, contact_id, subject, body, status, scheduled_for from touches where workspace_id = ${w.id} and step = 1 order by created_at desc`) as Draft[];
  const handoffs = (await sql()`
    select token, status, packet->>'who' who, packet->>'company' company, simulated, created_at from handoffs where workspace_id = ${w.id} order by created_at desc`) as
    { token: string; status: keyof typeof STATUS; who: string; company: string; simulated: boolean; created_at: string }[];
  const conns = (await sql()`
    select c.id, c.provider, c.last_sync_at, c.last_error, c.created_at, (select count(*)::int from crm_records r where r.connection_id = c.id) records
    from crm_connections c where c.workspace_id = ${w.id}`) as Conn[];
  const when = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never");
  const locked = !!w.claim.needs_review && !w.demo;
  const draftFor = (contactId: string) => w.demo
    ? w.detail.demo_drafts?.find(d => d.contact_id === contactId)
    : drafts.find(d => d.contact_id === contactId && d.status !== "cancelled");

  return (
    <main className="wrap">
      <FocusStars stars={[w.entity_id]} />
      <nav className="nav"><Logo /><span className="crumb">Private · {w.name}{w.demo ? " · DEMO" : ""}</span></nav>

      {w.demo && (
        <p className="band" style={{ display: "inline-block", background: "#a8640022", color: "#a86400", border: "1px solid #a8640088", marginTop: 8, whiteSpace: "normal", lineHeight: 1.5 }}>
          DEMO CLAIM · nobody posted from {w.name}&apos;s X account. Nothing here gets sent, and SYZYGY&apos;s own pitches carry on as normal.
        </p>
      )}
      {q.claimed && (
        <p className="panel" style={{ padding: "12px 16px", marginTop: 16, borderColor: "#1f8a5b66", color: "#9ff5cf" }}>
          You&apos;re in. This link is your workspace now, so bookmark it. It&apos;s the only way back.
        </p>
      )}
      {q.connected && <p className="panel" style={{ padding: "12px 16px", marginTop: 16, borderColor: "#1f8a5b66", color: "#9ff5cf" }}>Connected to {PROVIDERS[q.connected]?.label ?? q.connected}. The first sync has run.</p>}
      {q.error && <p className="panel" style={{ padding: "12px 16px", marginTop: 16, borderColor: "#ff6b5e66", color: "#ffb3aa" }}>That didn&apos;t work: {q.error}</p>}

      <section className="fade-up clear-hero">
        <p className="eyebrow">For {w.name}</p>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.04 }}>The companies<br />that need you.</h1>
        <p style={{ color: "var(--dim)", fontSize: 16.5, maxWidth: 620, marginTop: 14 }}>
          {targets.length} {targets.length === 1 ? "company's" : "companies'"} fans lean toward {w.name} harder than yours lean back. Here&apos;s who to talk to
          at each one, what to say, and the Qloo numbers behind it. {w.claimed_at && !w.demo ? `SYZYGY doesn't pitch them about you any more. That's yours now.` : ""}
        </p>
      </section>

      <section style={{ display: "grid", gap: 12, marginTop: 8 }}>
        {targets.length === 0 && <p className="panel" style={{ padding: 20, color: "var(--dim)" }}>Nothing yet. When Scout finds a company that needs {w.name}, it shows up here.</p>}
        {targets.map(t => {
          const ps = people.filter(p => p.entity_id === t.entity_id);
          return (
            <details key={t.id} className="panel play fade-up" style={{ padding: 0 }}>
              <summary style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center" }}>
                <span>
                  <strong style={{ fontSize: 17 }}>{t.name}</strong>
                  <span style={{ color: "var(--dim)", fontSize: 13.5 }}>
                    {t.lean ? ` · their fans → you ${Number(t.lean).toFixed(2)}` : ""}{t.back ? ` · yours → them ${Number(t.back).toFixed(2)}` : ""}
                    {` · ${ps.length ? `${ps.length} verified contact${ps.length === 1 ? "" : "s"}` : "no verified contact yet"}`}
                    {t.deal_status === "past" ? " · worked with you before" : ""}
                  </span>
                </span>
                <span className={`band band-${t.band}`}>{Number(t.score).toFixed(2)}</span>
              </summary>
              <div style={{ padding: "0 20px 20px", display: "grid", gap: 14, fontSize: 14.5 }}>
                {t.angle && <p style={{ margin: 0 }}><span className="eyebrow" style={{ display: "block", marginBottom: 4 }}>Angle</span>{t.angle}</p>}
                {t.timing && <p style={{ margin: 0, color: "var(--dim)" }}><span className="eyebrow" style={{ display: "block", marginBottom: 4 }}>Timing</span>{t.timing}</p>}
                <div>
                  <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Who to talk to</span>
                  {ps.length === 0 && <span style={{ color: "var(--dim)" }}>The Contact finder hasn&apos;t confirmed anyone here yet.</span>}
                  {ps.map(p => {
                    const d = draftFor(p.id);
                    return (
                      <div key={p.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0", display: "grid", gap: 8 }}>
                        <span>{p.kind === "person" ? <strong>{p.name}</strong> : <strong>Company inbox</strong>} <span style={{ color: "var(--dim)" }}>· {p.role}</span></span>
                        {d && (
                          <div style={{ borderLeft: "2px solid #5a5aa666", paddingLeft: 12 }}>
                            <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "#a86400" }}>
                              {w.demo ? "DEMO DRAFT · NOT SENT" : "DRAFT · waiting for approval"}{"scheduled_for" in d && d.scheduled_for ? ` · scheduled ${when(d.scheduled_for)}` : ""}
                            </span>
                            <strong style={{ display: "block", margin: "6px 0" }}>{d.subject}</strong>
                            <div style={{ whiteSpace: "pre-wrap", color: "var(--dim)", lineHeight: 1.6 }}>{d.body}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <a href={pathFor("accounts", t.slug, t.id)} style={{ color: "var(--cyan)", fontSize: 13.5 }}>All the numbers for {t.name} →</a>
              </div>
            </details>
          );
        })}
      </section>

      <section id="sending" className="panel fade-up" style={{ padding: 26, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 20 }}>Want SYZYGY to write to them for you?</h2>
          <span className="band" style={w.send_as ? { color: "#1f8a5b", borderColor: "#1f8a5b66" } : { color: "var(--mute)", borderColor: "var(--line)" }}>{w.send_as ? "ON" : "OFF"}</span>
        </div>
        <p style={{ color: "var(--dim)", fontSize: 14.5, maxWidth: 680, margin: "10px 0 16px" }}>
          It writes to the people above in your name and signs as you. The first line still says it&apos;s an AI agent working for {w.name}, and the numbers
          are credited to Qloo&apos;s taste data. Anyone who replies interested comes straight back to you, here. Switch it off and anything unsent is called off.
          For now nothing actually goes out: SYZYGY&apos;s mailbox isn&apos;t live yet, so these stay drafts you can read.
        </p>
        {!w.claimed_at ? (
          <p style={{ color: "#ffb3aa", margin: 0 }}>Claim the page first. This workspace was made by hand.</p>
        ) : locked ? (
          <p style={{ color: "#ffb3aa", margin: 0 }}>Waiting on a person: only one source says @{w.claim.handle} is {w.name}&apos;s account. Sending in your name opens once someone has checked.</p>
        ) : (
          <form action={sending} style={{ display: "grid", gap: 12, maxWidth: 520 }}>
            <input type="hidden" name="token" value={token} />
            <label className="field"><span>Sign the messages as</span><input name="signer" defaultValue={w.signer ?? ""} placeholder={signerOf(w)} maxLength={80} /></label>
            <label className="field"><span>Where interested replies should go (email, optional)</span><input name="email" type="email" defaultValue={w.handoff_email ?? ""} placeholder="partnerships@…" maxLength={120} /></label>
            <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn" name="on" value="1" type="submit">{w.send_as ? "Save" : "Switch it on"}</button>
              {w.send_as && <button className="btn warn" name="on" value="0" type="submit">Switch it off</button>}
            </span>
            <span style={{ color: "var(--mute)", fontSize: 12.5 }}>Switching on writes the first few drafts straight away (give it half a minute). The rest follow as contacts are confirmed.</span>
          </form>
        )}
      </section>

      <section className="panel fade-up" style={{ padding: 26, marginTop: 16 }}>
        <h2 style={{ fontSize: 20 }}>Interested replies</h2>
        {handoffs.length === 0
          ? <p style={{ color: "var(--dim)", fontSize: 14.5, margin: "10px 0 0" }}>None yet. When someone answers a message sent for you and wants to talk, the thread lands here with everything you need to pick it up.</p>
          : (
            <div style={{ display: "grid", marginTop: 10 }}>
              {handoffs.map(h => (
                <a key={h.token} href={handoffPath(h.token)} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
                  <span>{h.who} · {h.company}{h.simulated ? " (simulated)" : ""}</span>
                  <span style={{ color: "var(--dim)", fontSize: 13 }}>{STATUS[h.status]}</span>
                </a>
              ))}
            </div>
          )}
      </section>

      <h2 style={{ fontSize: 20, marginTop: 28 }}>Or take the list into your CRM</h2>
      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, marginTop: 12 }}>
        {Object.values(PROVIDERS).map(crm => {
          const c = conns.find(x => x.provider === crm.id);
          return (
            <div key={crm.id} className="panel" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <h3 style={{ fontSize: 18 }}>{crm.label}</h3>
                {c ? <span className="band" style={{ color: "#1f8a5b", borderColor: "#1f8a5b66" }}>CONNECTED</span>
                  : !crm.configured() ? <span className="band band-PASS">SOON</span> : null}
              </div>
              {c ? (
                <div style={{ display: "grid", gap: 4, fontSize: 13.5, color: "var(--dim)", marginTop: 12 }}>
                  <span>Last sync: {when(c.last_sync_at)}</span>
                  <span>{c.records} records sent so far</span>
                  {c.last_error && <span style={{ color: "#ffb3aa" }}>Last error: {c.last_error}</span>}
                </div>
              ) : (
                <p style={{ color: "var(--dim)", fontSize: 14, margin: "12px 0 16px" }}>
                  {crm.id === "hubspot" ? "Companies, contacts and a note on each company with the evidence." : "Accounts, contacts and a completed task on each account with the evidence."}
                </p>
              )}
              {!c && crm.configured() && (
                <a className="chip" href={`/api/crm/${crm.id}/connect?w=${token}`} style={{ padding: "8px 14px", fontSize: 13, borderColor: "#5a5aa688" }}>Connect {crm.label} →</a>
              )}
            </div>
          );
        })}
      </section>
      {conns.length > 0 && (
        <form action={syncNow} style={{ marginTop: 14 }}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn quiet">Sync now</button>
        </form>
      )}
      <p style={{ color: "var(--mute)", fontSize: 12.5, margin: "14px 0 0" }}>
        CRM tokens are stored encrypted and only used to write these records. Disconnect any time from your CRM&apos;s connected-apps settings.
      </p>
    </main>
  );
}

