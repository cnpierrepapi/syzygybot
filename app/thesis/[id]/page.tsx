import { notFound, permanentRedirect } from "next/navigation";
import { sql } from "@/lib/db";
import { FocusStars } from "../../components/Sky";
import type { Metadata } from "next";
import { clip, jsonLd, ORG } from "@/lib/seo";
import { SITE } from "@/lib/slug";
import { resolve, pathFor } from "@/lib/slug";
import { WEIGHTS, type Dim } from "@/lib/rubric";
import { DIM_COLOR, DIM_LABEL } from "@/lib/ui";
import { Alignment, Logo, ScoreRing, AgentChip } from "../../components/visuals";

export const dynamic = "force-dynamic";

type Row = {
  id: string; score: number; band: string; thesis: string | null; called_at: string; rubric_version: string;
  dims: { dims: Record<Dim, { score: number; raw: unknown; note: string }>; gate: string | null; raw?: { tagsA: string[]; tagsB: string[] } };
  a_name: string; a_type: string; a_handle: string | null; b_name: string; b_type: string; b_handle: string | null;
  account_id: string | null; account_name: string | null; account_slug: string | null; slug: string | null; a_id: string; b_id: string;
};

const fmt = (v: unknown): string =>
  v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3))
  : Array.isArray(v) ? v.join(", ") || "—"
  : typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k}: ${fmt(x)}`).join(" · ") : String(v);

const TYPE_LABEL: Record<string, string> = { brand: "brand", artist: "artist", tv_show: "TV show", movie: "film" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const hit = await resolve("pairs", (await params).id);
  if (!hit) return { title: "Thesis not found", robots: { index: false } };
  const [p] = (await sql()`
    select p.slug, p.band, p.score, p.thesis, p.called_at, a.name a_name, b.name b_name
    from pairs p join entities a on a.qloo_id = p.a_id join entities b on b.qloo_id = p.b_id where p.id = ${hit.id}`) as
    { slug: string | null; band: string; score: number; thesis: string | null; called_at: string; a_name: string; b_name: string }[];
  const title = `${p.a_name} × ${p.b_name}: ${p.band} partnership thesis (${Number(p.score).toFixed(2)})`;
  const description = clip(p.thesis ?? `How the audiences of ${p.a_name} and ${p.b_name} line up on Qloo taste data, scored by SYZYGY's Scout agent.`);
  const url = `/thesis/${p.slug ?? hit.id}`;
  return {
    title, description, alternates: { canonical: url },
    openGraph: { type: "article", url, title, description, publishedTime: new Date(p.called_at).toISOString() },
    twitter: { card: "summary_large_image", title, description },
    // A pair the rubric passed on has no thesis to read; keep it out of search.
    robots: p.band === "PASS" ? { index: false, follow: true } : undefined,
  };
}
export default async function Thesis({ params }: { params: Promise<{ id: string }> }) {
  const { id: key } = await params;
  const hit = await resolve("pairs", key);
  if (!hit) notFound();
  if (hit.redirect) permanentRedirect(hit.redirect);
  const id = hit.id;
  const [p] = (await sql()`
    select p.*, a.name a_name, a.type a_type, a.x_handle a_handle, b.name b_name, b.type b_type, b.x_handle b_handle,
      ac.id account_id, ac.slug account_slug, ae.name account_name
    from pairs p join entities a on a.qloo_id = p.a_id join entities b on b.qloo_id = p.b_id
    left join accounts ac on ac.id = p.account_id left join entities ae on ae.qloo_id = ac.entity_id
    where p.id = ${id} limit 1`) as Row[];
  if (!p) notFound();
  const dims = (Object.keys(WEIGHTS) as Dim[]);
  const pull = p.dims.dims.fit.raw as { pullAB: number | null; pullBA: number | null };
  const shared = (p.dims.dims.shared.raw as { shared?: string[] })?.shared ?? [];

  return (
    <main className="wrap">
      <h1 className="sr-only">{p.a_name} × {p.b_name}: partnership thesis</h1>
      <FocusStars stars={[p.a_id, p.b_id]} />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd({
        "@context": "https://schema.org", "@type": "Article",
        headline: `${p.a_name} × ${p.b_name}: ${p.band} partnership thesis`,
        description: p.thesis ?? undefined, datePublished: new Date(p.called_at).toISOString(),
        url: `${SITE}/thesis/${p.slug ?? p.id}`, mainEntityOfPage: `${SITE}/thesis/${p.slug ?? p.id}`,
        about: [{ "@type": "Thing", name: p.a_name }, { "@type": "Thing", name: p.b_name }],
        author: { "@type": "SoftwareApplication", name: "SYZYGY Scout agent", url: SITE },
        publisher: ORG, isBasedOn: "Qloo taste data",
      })} />
      <nav className="nav"><Logo /><span className="crumb">THESIS · called {new Date(p.called_at).toISOString().slice(0, 10)}</span></nav>

      <section className="panel fade-up" style={{ padding: "28px 28px 24px", marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <AgentChip agent="scout" label="Published by Scout" />
          <span className={`band band-${p.band}`}>{p.band}</span>
        </div>
        <Alignment a={p.a_name} b={p.b_name} aType={p.a_type} bType={p.b_type} height={170} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "start", gap: 12 }}>
          <div>
            <p className="pair-name" style={{ fontSize: "clamp(24px, 3.6vw, 40px)", lineHeight: 1.05 }}>{p.a_name}</p>
            <p style={{ color: "var(--dim)", margin: "6px 0 0", fontSize: 13 }}>{TYPE_LABEL[p.a_type] ?? p.a_type}{p.a_handle ? ` · @${p.a_handle}` : ""}</p>
          </div>
          <span className="grad-text" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>×</span>
          <div style={{ textAlign: "right" }}>
            <p className="pair-name" style={{ fontSize: "clamp(24px, 3.6vw, 40px)", lineHeight: 1.05 }}>{p.b_name}</p>
            <p style={{ color: "var(--dim)", margin: "6px 0 0", fontSize: 13 }}>{TYPE_LABEL[p.b_type] ?? p.b_type}{p.b_handle ? ` · @${p.b_handle}` : ""}</p>
          </div>
        </div>
      </section>

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: 16, marginTop: 16 }}>
        <div className="panel fade-up" style={{ padding: 26, animationDelay: "80ms" }}>
          <p className="eyebrow">The thesis</p>
          <p style={{ fontSize: 19, lineHeight: 1.55, margin: 0 }}>{p.thesis ?? "Below the bar: no thesis published for this pair."}</p>
          {p.dims.gate && <p style={{ color: "var(--orange)", fontFamily: "var(--mono)", fontSize: 13, marginTop: 14 }}>Gate: {p.dims.gate}</p>}
          {shared.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
              {shared.slice(0, 12).map(t => <span key={t} className="chip">{t}</span>)}
            </div>
          )}
          {p.account_id && (
            <a href={pathFor("accounts", p.account_slug, p.account_id!)} className="chip" style={{ marginTop: 20, padding: "8px 14px", fontSize: 13, borderColor: "#ff8a3d88" }}>
              Qualifier picked {p.account_name} as the buyer →
            </a>
          )}
        </div>
        <div className="panel fade-up" style={{ padding: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, animationDelay: "140ms" }}>
          <ScoreRing score={p.score} band={p.band} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, width: "100%" }}>
            <Pull from={p.a_name} to={p.b_name} v={pull.pullAB} />
            <Pull from={p.b_name} to={p.a_name} v={pull.pullBA} />
          </div>
        </div>
      </section>

      <section className="panel fade-up" style={{ padding: 26, marginTop: 16, animationDelay: "200ms" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontSize: 20 }}>Rubric {p.rubric_version}: how the score was built</h2>
          <span style={{ color: "var(--dim)", fontSize: 12.5, fontFamily: "var(--mono)" }}>bar = dimension score 0–1 · weight in brackets</span>
        </div>
        <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
          {dims.map(d => {
            const x = p.dims.dims[d];
            const w = WEIGHTS[d];
            return (
              <div key={d} title={`${DIM_LABEL[d]}: ${x.score.toFixed(2)} (weight ${w}). ${x.note}.`}
                style={{ display: "grid", gridTemplateColumns: "150px minmax(0, 1fr) 48px", gap: 14, alignItems: "center", opacity: w ? 1 : 0.5 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
                  <i style={{ width: 9, height: 9, borderRadius: 3, background: DIM_COLOR[d], display: "block" }} />
                  {DIM_LABEL[d]} <span style={{ color: "var(--mute)", fontFamily: "var(--mono)", fontSize: 12 }}>({w})</span>
                </span>
                <div>
                  <div style={{ height: 10, borderRadius: 5, background: "rgba(160,140,255,0.12)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.max(2, x.score * 100)}%`, height: "100%", borderRadius: 5, background: DIM_COLOR[d], boxShadow: `0 0 12px ${DIM_COLOR[d]}99` }} />
                  </div>
                  <div style={{ color: "var(--dim)", fontSize: 12.5, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.note} · {fmt(x.raw)}</div>
                </div>
                <span style={{ fontFamily: "var(--mono)", textAlign: "right" }}>{x.score.toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <p style={{ color: "var(--mute)", fontSize: 12.5, marginTop: 24, maxWidth: 760 }}>
        Source: Qloo taste data (hackathon API). Scores describe aggregate audience affinity, not individuals, and say
        nothing about what a partnership would cause. Written and published by the Scout agent with no human review.
      </p>
    </main>
  );
}

function Pull({ from, to, v }: { from: string; to: string; v: number | null }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", background: "rgba(255,255,255,0.03)" }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{v == null ? "—" : v.toFixed(2)}</div>
      <div style={{ color: "var(--dim)", fontSize: 11.5, lineHeight: 1.35 }}>{from} fans → {to}</div>
    </div>
  );
}
