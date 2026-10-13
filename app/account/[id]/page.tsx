import { notFound, permanentRedirect } from "next/navigation";
import { sql } from "@/lib/db";
import { FocusStars } from "../../components/Sky";
import type { Metadata } from "next";
import { clip } from "@/lib/seo";
import { resolve, pathFor } from "@/lib/slug";
import { maskEmail, STATUS_LABEL, typeColors } from "@/lib/ui";
import { Alignment, Logo, AgentChip } from "../../components/visuals";

export const dynamic = "force-dynamic";

type OutContact = { id: string; slug: string | null; touch_slug: string | null; kind: string; name: string | null; role: string; email: string | null; role_status: string; touch_id: string | null; touch_subject: string | null };
type Partner = { name: string; type: string; pullOut: number; pullBack: number };
type Row = {
  id: string; reason: string; created_at: string; pair_id: string; entity_id: string;
  name: string; type: string; x_handle: string | null; x_handle_status: string;
  passed_name: string; passed_type: string; pair_slug: string | null; passed_on: string | null;
  evidence: {
    pair?: { score: number; band: string; thesis: string | null };
    pull?: { partnerFansLikeAccount: number | null; accountFansLikePartner: number | null };
    sharedTaste?: string[];
    cities?: { shared: string[]; account: string[] };
    audienceAge?: Record<string, number> | null;
    morePartners?: Partner[];
    source?: string;
  };
};

const AGE_ORDER = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];
const AGE_LABEL: Record<string, string> = { "24_and_younger": "Under 25", "25_to_29": "25–29", "30_to_34": "30–34", "35_to_44": "35–44", "45_to_54": "45–54", "55_and_older": "55+" };
// Diverging: over-index warm, under-index cool, from the validated palette's orange and blue.
const OVER = "#d95926", UNDER = "#3987e5";
const n = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(2));
const TYPE_LABEL: Record<string, string> = { brand: "brand", artist: "artist", tv_show: "TV show", movie: "film" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const hit = await resolve("accounts", (await params).id);
  if (!hit) return { title: "Account not found", robots: { index: false } };
  const [a] = (await sql()`
    select ac.slug, ac.reason, e.name, p.name passed_name from accounts ac join entities e on e.qloo_id = ac.entity_id
    left join entities p on p.qloo_id = ac.passed_on where ac.id = ${hit.id}`) as { slug: string | null; reason: string; name: string; passed_name: string | null }[];
  const title = `${a.name}: audience evidence and outreach`;
  const description = clip(`Why SYZYGY's agents picked ${a.name} as the buyer${a.passed_name ? ` in the ${a.name} × ${a.passed_name} thesis` : ""}. ${a.reason}`);
  const url = `/account/${a.slug ?? hit.id}`;
  return { title, description, alternates: { canonical: url }, openGraph: { url, title, description }, twitter: { card: "summary_large_image", title, description } };
}
export default async function Account({ params }: { params: Promise<{ id: string }> }) {
  const { id: key } = await params;
  const hit = await resolve("accounts", key);
  if (!hit) notFound();
  if (hit.redirect) permanentRedirect(hit.redirect);
  const id = hit.id;
  const [a] = (await sql()`
    select ac.*, e.name, e.type, e.x_handle, e.x_handle_status, p.name passed_name, p.type passed_type, (select slug from pairs where id = ac.pair_id) pair_slug
    from accounts ac join entities e on e.qloo_id = ac.entity_id left join entities p on p.qloo_id = ac.passed_on
    where ac.id = ${id}`) as Row[];
  if (!a) notFound();
  const ev = a.evidence;
  // Outreach is per company: a second thesis for the same buyer shares the first one's contacts.
  const contacts = (await sql()`
    select c.id, c.slug, c.kind, c.name, c.role, c.email, c.role_status, t.id touch_id, t.slug touch_slug, t.subject touch_subject
    from contacts c join accounts x on x.id = c.account_id
    left join lateral (select id, slug, subject from touches where contact_id = c.id order by created_at desc limit 1) t on true
    where x.entity_id = ${a.entity_id}
    order by (c.role_status = 'confirmed') desc, c.kind desc, c.created_at`) as OutContact[];
  const [plan] = (await sql()`
    select pl.id, pl.slug, pl.angle from plans pl join accounts x on x.id = pl.account_id
    where x.entity_id = ${a.entity_id} order by pl.created_at desc limit 1`) as { id: string; slug: string | null; angle: string }[];
  // Later theses that picked this same company as the buyer (one account per company).
  const othersAll = (await sql()`
    select p.id, p.slug, p.score, p.band, case when p.a_id = ${a.entity_id} then eb.name else ea.name end partner
    from pairs p join entities ea on ea.qloo_id = p.a_id join entities eb on eb.qloo_id = p.b_id
    where p.account_id = ${a.id} and p.id <> ${a.pair_id} order by p.score desc`) as { id: string; slug: string | null; score: number; band: string; partner: string }[];
  // The same pair scored under two rubric versions shows once, at its best score.
  const others = othersAll.filter((o, i, all) => all.findIndex(x => x.partner === o.partner) === i);
  const [c1, c2] = typeColors(a.type);

  return (
    <main className="wrap">
      <FocusStars stars={[a.entity_id, ...(a.passed_on ? [a.passed_on] : [])]} />
      <nav className="nav"><Logo /><span className="crumb">ACCOUNT · qualified {new Date(a.created_at).toISOString().slice(0, 10)}</span></nav>

      <section className="fade-up clear-hero" style={{ padding: "28px 4px 34px", marginTop: 8, position: "relative" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <AgentChip agent="qualifier" label="Picked by Qualifier" />
          <AgentChip agent="numbers" label="Evidence by Numbers" />
        </div>
        <p className="eyebrow" style={{ marginTop: 22 }}>The buyer</p>
        <h1 style={{ fontSize: "clamp(36px, 6vw, 68px)", lineHeight: 1, position: "relative" }}>{a.name}</h1>
        <p style={{ color: "var(--dim)", margin: "10px 0 0", position: "relative" }}>
          {TYPE_LABEL[a.type] ?? a.type}{a.x_handle ? ` · X @${a.x_handle} (${a.x_handle_status})` : ""}
          {" · "}<a href={pathFor("pairs", a.pair_slug, a.pair_id)} style={{ color: "var(--cyan)" }}>from the {a.name} × {a.passed_name} thesis →</a>
        </p>
        {others.length > 0 && (
          <p style={{ color: "var(--dim)", margin: "8px 0 0", position: "relative", fontSize: 14 }}>
            Also pointed here by{" "}
            {others.map((o, i) => (
              <span key={o.id}>{i ? ", " : ""}<a href={pathFor("pairs", o.slug, o.id)} style={{ color: "var(--cyan)" }}>{o.partner}</a> ({o.band} {o.score.toFixed(2)})</span>
            ))}
          </p>
        )}
      </section>

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16, marginTop: 16 }}>
        <div className="panel fade-up" style={{ padding: 26, animationDelay: "80ms" }}>
          <p className="eyebrow">Why this side</p>
          <p style={{ fontSize: 18, lineHeight: 1.55, margin: 0 }}>{a.reason}</p>
          <p style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, color: "var(--dim)", fontSize: 13.5 }}>
            <span className="chip" style={{ borderColor: "#e6676788" }}>never contacted</span>
            {a.passed_name} ({TYPE_LABEL[a.passed_type] ?? a.passed_type}) is evidence only.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Stat label={`${a.passed_name} fans → ${a.name}`} value={n(ev.pull?.partnerFansLikeAccount)} glow="#ff3d9a" />
          <Stat label={`${a.name} fans → ${a.passed_name}`} value={n(ev.pull?.accountFansLikePartner)} glow="#3de0ff" />
          <div className="panel" style={{ gridColumn: "1 / -1", padding: 18, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--dim)", fontSize: 13 }}>Pair score</span>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <strong style={{ fontSize: 26 }}>{n(ev.pair?.score)}</strong>
              {ev.pair?.band && <span className={`band band-${ev.pair.band}`}>{ev.pair.band}</span>}
            </span>
          </div>
        </div>
      </section>

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, marginTop: 16 }}>
        <div className="panel fade-up" style={{ padding: 26, animationDelay: "140ms" }}>
          <p className="eyebrow">Who the audience is</p>
          <h3 style={{ fontSize: 17, marginBottom: 4 }}>{a.name} audience by age</h3>
          <p style={{ color: "var(--dim)", fontSize: 12.5, margin: "0 0 16px" }}>
            <span style={{ color: OVER }}>■</span> over-indexes (right) · <span style={{ color: UNDER }}>■</span> under-indexes (left), relative to Qloo&apos;s baseline
          </p>
          {ev.audienceAge ? (
            <div style={{ display: "grid", gap: 9 }}>
              {AGE_ORDER.filter(k => k in ev.audienceAge!).map(k => {
                const v = ev.audienceAge![k];
                return (
                  <div key={k} title={`${AGE_LABEL[k]}: ${v > 0 ? "+" : ""}${v.toFixed(2)}`} style={{ display: "grid", gridTemplateColumns: "70px 1fr 52px", gap: 10, alignItems: "center" }}>
                    <span style={{ color: "var(--dim)", fontSize: 13 }}>{AGE_LABEL[k]}</span>
                    <span style={{ position: "relative", height: 14 }}>
                      <span style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: "var(--mute)" }} />
                      <span style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 4, left: v < 0 ? `${50 + v * 50}%` : "50%", width: `${Math.abs(v) * 50}%`, background: v < 0 ? UNDER : OVER }} />
                    </span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 13, textAlign: "right" }}>{v > 0 ? "+" : ""}{v.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          ) : <p style={{ color: "var(--dim)" }}>No demographic data from Qloo for this entity.</p>}
        </div>
        <div className="panel fade-up" style={{ padding: 26, animationDelay: "180ms" }}>
          <p className="eyebrow">Where</p>
          <h3 style={{ fontSize: 17, marginBottom: 12 }}>Cities where both audiences are strong</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(ev.cities?.shared.length ? ev.cities.shared : ["none in the top cells"]).map(c => (
              <span key={c} className="chip" style={{ fontSize: 13, padding: "6px 12px", borderColor: "#ffd23d88", boxShadow: "0 0 14px rgba(255,210,61,0.18)" }}>◎ {c}</span>
            ))}
          </div>
          <h3 style={{ fontSize: 15, margin: "22px 0 10px", color: "var(--dim)" }}>{a.name}&apos;s strongest US cities</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(ev.cities?.account ?? []).map(c => <span key={c} className="chip">{c}</span>)}
          </div>
          {!!ev.sharedTaste?.length && (
            <>
              <h3 style={{ fontSize: 15, margin: "22px 0 10px", color: "var(--dim)" }}>Taste the two audiences share</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{ev.sharedTaste.map(t => <span key={t} className="chip">{t}</span>)}</div>
            </>
          )}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 22, marginBottom: 6 }}>Three more partners Qloo found for <span className="grad-text">{a.name}</span></h2>
        <p style={{ color: "var(--dim)", margin: "0 0 14px", fontSize: 14 }}>The pitch sells Qloo&apos;s breadth, not one deal. Affinity out = {a.name} fans → partner; back = partner fans → {a.name}.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {(ev.morePartners ?? []).map((p, i) => (
            <div key={p.name} className="panel fade-up" style={{ padding: 18, animationDelay: `${220 + i * 80}ms` }}>
              <Alignment a={a.name} b={p.name} aType={a.type} bType={p.type} height={64} />
              <strong style={{ display: "block", fontSize: 17, marginTop: 8 }}>{p.name}</strong>
              <span style={{ color: "var(--dim)", fontSize: 12.5 }}>{TYPE_LABEL[p.type] ?? p.type}</span>
              <div style={{ display: "flex", gap: 16, marginTop: 10, fontFamily: "var(--mono)", fontSize: 13 }}>
                <span>out <strong style={{ fontSize: 18 }}>{n(p.pullOut)}</strong></span>
                <span>back <strong style={{ fontSize: 18 }}>{n(p.pullBack)}</strong></span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 22, marginBottom: 6 }}>Outreach</h2>
        {contacts.length === 0 ? (
          <p style={{ color: "var(--dim)", fontSize: 14 }}>The Contact finder has not reached this account yet. It works one account per run, every three hours.</p>
        ) : (
          <>
            <p style={{ color: "var(--dim)", margin: "0 0 14px", fontSize: 14 }}>
              {contacts.length} found, {contacts.filter(c => c.role_status === "confirmed").length} verified. Only verified contacts get a message.
              {plan && <> <a href={pathFor("plans", plan.slug, plan.id)} style={{ color: "var(--cyan)" }}>See the plan →</a></>}
            </p>
            <div className="panel" style={{ overflow: "hidden" }}>
              {contacts.map(c => {
                const st = STATUS_LABEL[c.role_status] ?? STATUS_LABEL.unconfirmed;
                return (
                  <div key={c.id} className="feed-row" style={{ gridTemplateColumns: "118px minmax(0, 1fr) auto", boxShadow: `inset 3px 0 0 ${st.color}88` }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: st.color }}>{st.label}</span>
                    <a href={pathFor("contacts", c.slug, c.id)} style={{ minWidth: 0 }}>
                      <strong>{c.kind === "person" ? c.name : maskEmail(c.email)}</strong> <span style={{ color: "var(--dim)" }}>· {c.role}</span>
                    </a>
                    {c.touch_id ? <a href={pathFor("touches", c.touch_slug, c.touch_id)} style={{ color: "var(--cyan)", fontSize: 13 }}>message →</a> : <span />}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <p style={{ color: "var(--mute)", fontSize: 12.5, marginTop: 24, maxWidth: 760 }}>
        {ev.source ?? "Source: Qloo taste data."} Picked by the Qualifier and assembled by the Numbers agent with no human review.
      </p>
    </main>
  );
}

function Stat({ label, value, glow }: { label: string; value: string; glow: string }) {
  return (
    <div className="panel" style={{ padding: 18, borderColor: `${glow}44` }}>
      <div style={{ fontSize: 34, fontWeight: 700, textShadow: `0 0 20px ${glow}88` }}>{value}</div>
      <div style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.35, marginTop: 4 }}>{label}</div>
    </div>
  );
}
