import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { WEIGHTS, type Dim } from "@/lib/rubric";

export const dynamic = "force-dynamic";

type Row = {
  id: string; score: number; band: string; thesis: string | null; called_at: string; rubric_version: string;
  dims: { dims: Record<Dim, { score: number; raw: unknown; note: string }>; gate: string | null };
  a_name: string; a_type: string; a_handle: string | null; b_name: string; b_type: string; b_handle: string | null;
};

const fmt = (v: unknown): string =>
  v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3))
  : Array.isArray(v) ? v.join(", ") || "—"
  : typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k}: ${fmt(x)}`).join(" · ") : String(v);

export default async function Thesis({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [p] = (await sql()`
    select p.*, a.name a_name, a.type a_type, a.x_handle a_handle, b.name b_name, b.type b_type, b.x_handle b_handle
    from pairs p join entities a on a.qloo_id = p.a_id join entities b on b.qloo_id = p.b_id
    where p.id = ${id}`) as Row[];
  if (!p) notFound();

  return (
    <main style={{ padding: "48px 6vw", maxWidth: 1000 }}>
      <p style={{ margin: 0, letterSpacing: "0.2em" }}><a href="/" style={{ color: "var(--hot)" }}>SYZYGY</a> / THESIS</p>
      <h1 style={{ fontSize: "clamp(28px, 5vw, 56px)", margin: "12px 0 4px", lineHeight: 1.05 }}>
        {p.a_name} <span style={{ color: "var(--hot)" }}>×</span> {p.b_name}
      </h1>
      <p style={{ color: "var(--dim)", margin: 0 }}>
        {p.a_type} × {p.b_type} · called on {new Date(p.called_at).toISOString().slice(0, 10)} · rubric {p.rubric_version}
      </p>
      <p style={{ fontSize: 22, margin: "28px 0 8px" }}>
        <b style={{ color: p.band === "PITCH" ? "var(--hot)" : "var(--fg)" }}>{p.band}</b> · {p.score.toFixed(2)}
        {p.dims.gate && <span style={{ color: "var(--dim)", fontSize: 14 }}> · gate: {p.dims.gate}</span>}
      </p>
      {p.thesis && <p style={{ fontSize: 18, lineHeight: 1.5, maxWidth: 760 }}>{p.thesis}</p>}

      <h2 style={{ marginTop: 40, fontSize: 14, letterSpacing: "0.2em", color: "var(--dim)" }}>EVIDENCE</h2>
      <div style={{ borderTop: "1px solid var(--line)" }}>
        {(Object.keys(WEIGHTS) as Dim[]).map(d => {
          const x = p.dims.dims[d];
          return (
            <div key={d} style={{ display: "grid", gridTemplateColumns: "110px 60px 70px 1fr", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <span style={{ color: "var(--hot)" }}>{d}</span>
              <span style={{ color: "var(--dim)" }}>w{WEIGHTS[d]}</span>
              <span>{x.score.toFixed(2)}</span>
              <span><span style={{ color: "var(--dim)" }}>{x.note}.</span> {fmt(x.raw)}</span>
            </div>
          );
        })}
      </div>
      <p style={{ color: "var(--dim)", marginTop: 32, maxWidth: 760, lineHeight: 1.5 }}>
        Source: Qloo taste data (hackathon API). Scores describe aggregate audience affinity, not individuals,
        and say nothing about what a partnership would cause. Written and published by the Scout agent with no human review.
      </p>
    </main>
  );
}
