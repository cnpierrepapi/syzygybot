import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { sql } from "@/lib/db";
import { FocusStars } from "../../components/Sky";
import { resolve, pathFor } from "@/lib/slug";
import { maskEmail, STATUS_LABEL } from "@/lib/ui";
import { Logo, AgentChip } from "../../components/visuals";

// About a person, or a working document: visible on the floor, kept out of search results.
export const metadata: Metadata = { title: "Contact", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

type Check = { url: string; http: number | null; name: boolean; company: boolean; role: boolean };
type Row = {
  id: string; kind: string; name: string | null; role: string; email: string | null; email_status: string;
  role_status: string; sources: string[]; verified_at: string | null; created_at: string;
  verification: { checked?: Check[]; page?: string | null; date?: string | null; claimed?: { url: string | null; date: string | null }; publishedOn?: string | null; mx?: boolean };
  account_id: string; account_name: string; touch_id: string | null; touch_subject: string | null; account_slug: string | null; touch_slug: string | null; entity_id: string;
};

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const Tick = ({ ok }: { ok: boolean }) => <span style={{ color: ok ? "#2fd39a" : "var(--mute)", fontFamily: "var(--mono)" }}>{ok ? "✓" : "·"}</span>;

export default async function Contact({ params }: { params: Promise<{ id: string }> }) {
  const { id: key } = await params;
  const hit = await resolve("contacts", key);
  if (!hit) notFound();
  if (hit.redirect) permanentRedirect(hit.redirect);
  const id = hit.id;
  const [c] = (await sql()`
    select c.*, ac.id account_id, ac.entity_id, ac.slug account_slug, e.name account_name, t.id touch_id, t.slug touch_slug, t.subject touch_subject
    from contacts c join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    left join lateral (select id, slug, subject from touches where contact_id = c.id order by created_at desc limit 1) t on true
    where c.id = ${id}`) as Row[];
  if (!c) notFound();
  const st = STATUS_LABEL[c.role_status] ?? STATUS_LABEL.unconfirmed;
  const v = c.verification;
  const checked = (v.checked ?? []).filter(x => x.name);

  return (
    <main className="wrap">
      <FocusStars stars={[c.entity_id]} />
      <nav className="nav"><Logo /><span className="crumb">CONTACT · found {new Date(c.created_at).toISOString().slice(0, 10)}</span></nav>

      <section className="panel fade-up" style={{ padding: 28, marginTop: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <AgentChip agent="contact_finder" label="Found by Contact finder" />
            <AgentChip agent="verifier" label="Checked by Verifier" />
          </div>
          <span className="band" style={{ background: `${st.color}22`, color: st.color, border: `1px solid ${st.color}88` }}>{st.label}</span>
        </div>
        <p className="eyebrow" style={{ marginTop: 22 }}>{c.kind === "person" ? "Named buyer" : "Published inbox"}</p>
        <h1 style={{ fontSize: "clamp(30px, 5vw, 56px)", lineHeight: 1.05 }}>{c.kind === "person" ? c.name : maskEmail(c.email)}</h1>
        <p style={{ color: "var(--dim)", margin: "10px 0 0" }}>
          {c.role} · <a href={pathFor("accounts", c.account_slug, c.account_id)} style={{ color: "var(--cyan)" }}>{c.account_name} →</a>
        </p>
        {c.touch_id && (
          <a href={pathFor("touches", c.touch_slug, c.touch_id!)} className="chip" style={{ marginTop: 18, padding: "8px 14px", fontSize: 13, borderColor: "#ff6fa688" }}>
            Writer drafted: “{c.touch_subject}” →
          </a>
        )}
      </section>

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16, marginTop: 16 }}>
        <div className="panel fade-up" style={{ padding: 26, animationDelay: "80ms" }}>
          <p className="eyebrow">How it was verified</p>
          {c.kind === "person" ? (
            <>
              <p style={{ margin: "0 0 16px", lineHeight: 1.55 }}>
                The Verifier does not trust the Contact finder. It fetched every page itself and kept this person only if one
                page names them, names {c.account_name}, and puts a matching role word near the name. Pages older than two
                years count as stale unless they are on the company&apos;s own site.
              </p>
              {checked.length ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 56px 64px 44px", gap: 10, fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--mute)" }}>
                    <span>page read</span><span>name</span><span>company</span><span>role</span>
                  </div>
                  {checked.map(x => (
                    <div key={x.url} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 56px 64px 44px", gap: 10, fontSize: 13.5, alignItems: "center" }}>
                      <a href={x.url} rel="nofollow noopener" target="_blank" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: x.url === v.page ? "#efeaff" : "var(--dim)" }}>
                        {x.url === v.page ? "★ " : ""}{host(x.url)}
                      </a>
                      <Tick ok={x.name} /><Tick ok={x.company} /><Tick ok={x.role} />
                    </div>
                  ))}
                </div>
              ) : <p style={{ color: "var(--dim)" }}>No page it could read mentions this name.</p>}
            </>
          ) : (
            <div style={{ display: "grid", gap: 10, fontSize: 15 }}>
              <span><Tick ok={!!v.publishedOn} /> Published by {c.account_name} on a page the Verifier read{v.publishedOn ? <> (<a href={v.publishedOn} target="_blank" rel="nofollow noopener" style={{ color: "var(--cyan)" }}>{host(v.publishedOn)}</a>)</> : ""}</span>
              <span><Tick ok={!!v.mx} /> The domain has mail servers (MX record)</span>
              <span style={{ color: "var(--dim)", fontSize: 13.5 }}>Role inboxes are company routes, not people. Personal addresses are never guessed.</span>
            </div>
          )}
        </div>
        <div className="panel fade-up" style={{ padding: 26, animationDelay: "140ms" }}>
          <p className="eyebrow">Record</p>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 16px", margin: 0, fontSize: 14 }}>
            <dt style={{ color: "var(--dim)" }}>Status</dt><dd style={{ margin: 0, color: st.color }}>{st.label.toLowerCase()}</dd>
            <dt style={{ color: "var(--dim)" }}>Email</dt><dd style={{ margin: 0, fontFamily: "var(--mono)" }}>{maskEmail(c.email) ?? "none: no personal address is guessed"}</dd>
            {v.date && <><dt style={{ color: "var(--dim)" }}>Page date</dt><dd style={{ margin: 0 }}>{v.date}</dd></>}
            {v.claimed?.url && <><dt style={{ color: "var(--dim)" }}>Finder cited</dt><dd style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{host(v.claimed.url)}</dd></>}
            <dt style={{ color: "var(--dim)" }}>Checked</dt><dd style={{ margin: 0 }}>{c.verified_at ? new Date(c.verified_at).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—"}</dd>
          </dl>
          <p style={{ color: "var(--mute)", fontSize: 12.5, marginTop: 18 }}>Sources are public pages only: company sites, press releases, trade press. Never LinkedIn.</p>
        </div>
      </section>
    </main>
  );
}
