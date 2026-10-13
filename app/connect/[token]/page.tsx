import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { FocusStars } from "../../components/Sky";
import { PROVIDERS, syncConnection } from "@/lib/crm";
import { pathFor } from "@/lib/slug";
import { Logo } from "../../components/visuals";

// A brand's private page: whoever holds the link can connect that brand's CRM. Never in search.
export const metadata: Metadata = { title: "Connect your CRM", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Ws = { id: string; entity_id: string; name: string };
type Conn = { id: string; provider: string; last_sync_at: string | null; last_error: string | null; created_at: string; records: number };

async function load(token: string) {
  if (!/^[A-Za-z0-9]{8,64}$/.test(token)) return null;
  const [w] = (await sql()`select w.id, w.entity_id, e.name from workspaces w join entities e on e.qloo_id = w.entity_id where w.connect_token = ${token}`) as Ws[];
  return w ?? null;
}

async function syncNow(formData: FormData) {
  "use server";
  const w = await load(String(formData.get("token")));
  if (!w) return;
  for (const c of (await sql()`select * from crm_connections where workspace_id = ${w.id}`) as Parameters<typeof syncConnection>[0][]) {
    await syncConnection(c).catch(async e => { await sql()`update crm_connections set last_error = ${String((e as Error).message).slice(0, 500)} where id = ${c.id}`; });
  }
  revalidatePath(`/connect/${formData.get("token")}`);
}

export default async function Connect({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ connected?: string; error?: string }> }) {
  const { token } = await params;
  const w = await load(token);
  if (!w) notFound();
  const q = await searchParams;
  const targets = (await sql()`
    select ac.id, ac.slug, e.name, p.band, p.score from accounts ac join entities e on e.qloo_id = ac.entity_id join pairs p on p.id = ac.pair_id
    where ac.passed_on = ${w.entity_id} order by p.score desc`) as { id: string; slug: string | null; name: string; band: string; score: number }[];
  const conns = (await sql()`
    select c.id, c.provider, c.last_sync_at, c.last_error, c.created_at, (select count(*)::int from crm_records r where r.connection_id = c.id) records
    from crm_connections c where c.workspace_id = ${w.id}`) as Conn[];
  const when = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never");

  return (
    <main className="wrap">
      <FocusStars stars={[w.entity_id]} />
      <nav className="nav"><Logo /><span className="crumb">Private · {w.name}</span></nav>

      <section className="fade-up clear-hero">
        <p className="eyebrow">For {w.name}</p>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.04 }}>Brands that need you,<br />straight into your CRM.</h1>
        <p style={{ color: "var(--dim)", fontSize: 16.5, maxWidth: 620, marginTop: 14 }}>
          SYZYGY found {targets.length} {targets.length === 1 ? "company" : "companies"} whose audience leans toward yours harder than yours leans
          back. Connect your CRM and each one lands as a company, with the people who decide there, the Qloo numbers, the angle and
          a first message already drafted. New ones follow on their own.
        </p>
      </section>

      {q.connected && <p className="panel" style={{ padding: "12px 16px", marginTop: 16, borderColor: "#34f5a066", color: "#9ff5cf" }}>Connected to {PROVIDERS[q.connected]?.label ?? q.connected}. The first sync has run.</p>}
      {q.error && <p className="panel" style={{ padding: "12px 16px", marginTop: 16, borderColor: "#ff6b5e66", color: "#ffb3aa" }}>That didn't work: {q.error}</p>}

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, marginTop: 16 }}>
        {Object.values(PROVIDERS).map(crm => {
          const c = conns.find(x => x.provider === crm.id);
          return (
            <div key={crm.id} className="panel" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <h2 style={{ fontSize: 20 }}>{crm.label}</h2>
                {c ? <span className="band" style={{ color: "#34f5a0", borderColor: "#34f5a066" }}>CONNECTED</span>
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
                <a className="chip" href={`/api/crm/${crm.id}/connect?w=${token}`} style={{ padding: "8px 14px", fontSize: 13, borderColor: "#22d3ee88" }}>Connect {crm.label} →</a>
              )}
            </div>
          );
        })}
      </section>

      {conns.length > 0 && (
        <form action={syncNow} style={{ marginTop: 14 }}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="chip" style={{ cursor: "pointer", padding: "8px 14px", fontSize: 13, color: "var(--fg)" }}>Sync now</button>
        </form>
      )}

      <section className="panel" style={{ padding: 24, marginTop: 16 }}>
        <p className="eyebrow">What goes across</p>
        <div style={{ display: "grid", gap: 8 }}>
          {targets.length === 0 && <span style={{ color: "var(--dim)" }}>Nothing yet. When Scout finds a company that needs {w.name}, it shows up here.</span>}
          {targets.map(t => (
            <a key={t.id} href={pathFor("accounts", t.slug, t.id)} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <span>{t.name}</span><span className={`band band-${t.band}`}>{Number(t.score).toFixed(2)}</span>
            </a>
          ))}
        </div>
        <p style={{ color: "var(--mute)", fontSize: 12.5, margin: "14px 0 0" }}>
          Tokens are stored encrypted and only used to write these records. Disconnect any time from your CRM&apos;s connected-apps settings.
        </p>
      </section>
    </main>
  );
}
