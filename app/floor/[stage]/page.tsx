import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { STAGES, stage } from "@/lib/stages";
import { agentColor } from "@/lib/ui";
import { Logo, AgentChip } from "../../components/visuals";

// Lists people and working documents, like the pages it links to: visible on the floor, kept out of search.
export const metadata: Metadata = { title: "Live floor", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

export default async function StagePage({ params }: { params: Promise<{ stage: string }> }) {
  const { stage: slug } = await params;
  const s = stage(slug);
  if (!s) notFound();
  const [rows, count] = await Promise.all([s.rows(), s.count ? s.count() : Promise.resolve(null)]);
  const c = agentColor(s.agent);

  return (
    <main className="wrap">
      <nav className="nav"><Logo /><span className="crumb">LIVE FLOOR · {s.label}</span></nav>

      <div className="stage-tabs fade-up">
        {STAGES.map(x => (
          <a key={x.slug} href={`/floor/${x.slug}`} className="chip" style={x.slug === s.slug ? { borderColor: c, color: "#efeaff", background: `${c}33`, boxShadow: `0 0 12px ${c}55` } : undefined}>{x.label}</a>
        ))}
      </div>

      <section className="panel fade-up" style={{ padding: 28, marginTop: 16 }}>
        <AgentChip agent={s.agent} />
        <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", margin: "18px 0 6px" }}>
          <span style={{ textShadow: `0 0 18px ${c}88` }}>{count ?? rows.length}</span> {s.label.toLowerCase()}
        </h1>
        <p style={{ color: "var(--dim)", margin: 0 }}>{s.blurb}</p>
      </section>

      <section className="panel fade-up" style={{ marginTop: 16, padding: 0, animationDelay: "80ms" }}>
        {rows.length === 0 && <p style={{ color: "var(--dim)", padding: "18px 20px", margin: 0 }}>Nothing here yet.</p>}
        {rows.map(r => {
          const inner = (
            <>
              <span style={{ color: "var(--mute)", fontFamily: "var(--mono)", fontSize: 12 }}>{r.when}</span>
              <span style={{ minWidth: 0 }}>
                <strong>{r.title}</strong>
                <span style={{ display: "block", color: "var(--dim)", fontSize: 13, marginTop: 2 }}>{r.sub}</span>
              </span>
              <span>{r.tag && <span className={`band band-${r.tag.split(" ")[0]}`}>{r.tag}</span>}</span>
            </>
          );
          return r.href
            ? <a key={r.key} href={r.href} className="stage-row">{inner}</a>
            : <div key={r.key} className="stage-row">{inner}</div>;
        })}
      </section>
    </main>
  );
}
