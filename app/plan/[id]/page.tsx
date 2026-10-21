import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { sql } from "@/lib/db";
import { FocusStars } from "../../components/Sky";
import { resolve, pathFor } from "@/lib/slug";
import { Logo, AgentChip } from "../../components/visuals";

// About a person, or a working document: visible on the floor, kept out of search results.
export const metadata: Metadata = { title: "Outreach plan", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

type Trigger = { what: string; date?: string; verified?: boolean; page?: string; source_url?: string };
type Row = {
  id: string; angle: string; created_at: string; account_id: string; account_name: string; account_slug: string | null; entity_id: string;
  channels: { contact_id: string; channel: string; why: string }[];
  triggers: Trigger[]; detail: { timing?: string };
  contacts: { id: string; slug: string | null; name: string | null; role: string; touch_id: string | null; touch_slug: string | null }[];
};

const host = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };

export default async function Plan({ params }: { params: Promise<{ id: string }> }) {
  const { id: key } = await params;
  const hit = await resolve("plans", key);
  if (!hit) notFound();
  if (hit.redirect) permanentRedirect(hit.redirect);
  const id = hit.id;
  const [p] = (await sql()`
    select pl.*, ac.id account_id, ac.entity_id, ac.slug account_slug, e.name account_name,
      coalesce((select json_agg(json_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'role', c.role,
        'touch_slug', (select t.slug from touches t where t.contact_id = c.id and t.plan_id = pl.id limit 1),
        'touch_id', (select t.id from touches t where t.contact_id = c.id and t.plan_id = pl.id limit 1)))
        from contacts c where c.account_id = ac.id and c.role_status = 'confirmed'), '[]') contacts
    from plans pl join accounts ac on ac.id = pl.account_id join entities e on e.qloo_id = ac.entity_id
    where pl.id = ${id}`) as Row[];
  if (!p) notFound();
  const byId = new Map(p.contacts.map(c => [c.id, c]));
  const kept = p.triggers.filter(t => t.verified), dropped = p.triggers.filter(t => !t.verified);

  return (
    <main className="wrap">
      <h1 className="sr-only">Outreach plan for {p.account_name}</h1>
      <FocusStars stars={[p.entity_id]} />
      <nav className="nav"><Logo /><span className="crumb">PLAN · set {new Date(p.created_at).toISOString().slice(0, 10)}</span></nav>

      <section className="panel fade-up" style={{ padding: 28, marginTop: 8 }}>
        <AgentChip agent="strategist" label="Set by Strategist" />
        <p className="eyebrow" style={{ marginTop: 22 }}>The angle for <a href={pathFor("accounts", p.account_slug, p.account_id)} style={{ color: "var(--cyan)" }}>{p.account_name}</a></p>
        <p style={{ fontSize: "clamp(20px, 2.4vw, 28px)", lineHeight: 1.35, margin: 0 }}>{p.angle}</p>
        {p.detail.timing && <p style={{ color: "var(--dim)", marginTop: 16 }}><strong style={{ color: "#a86400" }}>When:</strong> {p.detail.timing}</p>}
      </section>

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, marginTop: 16 }}>
        <div className="panel fade-up" style={{ padding: 26, animationDelay: "80ms" }}>
          <p className="eyebrow">Channels</p>
          <div style={{ display: "grid", gap: 12 }}>
            {p.channels.map(ch => {
              const c = byId.get(ch.contact_id);
              return (
                <div key={ch.contact_id} style={{ borderLeft: "3px solid #ff6fa6", paddingLeft: 12 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="chip">{ch.channel}</span>
                    {c ? <a href={pathFor("contacts", c.slug, c.id)}><strong>{c.name ?? c.role}</strong></a> : <strong>contact</strong>}
                    {c?.touch_id && <a href={pathFor("touches", c.touch_slug, c.touch_id)} style={{ color: "var(--cyan)", fontSize: 13 }}>message →</a>}
                  </div>
                  <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "6px 0 0" }}>{ch.why}</p>
                </div>
              );
            })}
          </div>
        </div>
        <div className="panel fade-up" style={{ padding: 26, animationDelay: "140ms" }}>
          <p className="eyebrow">Timing triggers</p>
          <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "0 0 14px" }}>A trigger is used only if the Strategist can read a page that backs it.</p>
          <div style={{ display: "grid", gap: 12 }}>
            {[...kept, ...dropped].map((t, i) => (
              <div key={i} style={{ opacity: t.verified ? 1 : 0.55 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ color: t.verified ? "#1f8a5b" : "var(--mute)", fontFamily: "var(--mono)", fontSize: 12 }}>{t.verified ? "USED" : "DROPPED"}</span>
                  {t.date && <span style={{ color: "var(--mute)", fontFamily: "var(--mono)", fontSize: 12 }}>{t.date}</span>}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 14.5 }}>{t.what}</p>
                {t.verified && t.page && <a href={t.page} target="_blank" rel="nofollow noopener" style={{ color: "var(--cyan)", fontSize: 12.5 }}>{host(t.page)}</a>}
              </div>
            ))}
            {!p.triggers.length && <p style={{ color: "var(--dim)", margin: 0 }}>No triggers found.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
