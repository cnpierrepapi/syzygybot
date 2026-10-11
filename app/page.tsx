import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = { id: string; agent: string; kind: string; summary: string; created_at: string };

async function recent(): Promise<Row[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    return (await sql()`select id, agent, kind, summary, created_at from actions order by created_at desc limit 50`) as Row[];
  } catch {
    return [];
  }
}

export default async function Floor() {
  const rows = await recent();
  return (
    <main style={{ padding: "48px 6vw" }}>
      <p style={{ color: "var(--hot)", letterSpacing: "0.2em", margin: 0 }}>SYZYGY / SDR FLOOR</p>
      <h1 style={{ fontSize: "clamp(32px, 6vw, 72px)", margin: "12px 0 8px", lineHeight: 1 }}>
        No humans. Every action on this page was taken by agents.
      </h1>
      <p style={{ color: "var(--dim)", maxWidth: 640 }}>Built on Qloo&apos;s taste data.</p>
      <section style={{ marginTop: 48, borderTop: "1px solid var(--line)" }}>
        {rows.length === 0 && <p style={{ color: "var(--dim)" }}>The floor is quiet. No agent has acted yet.</p>}
        {rows.map(r => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "180px 140px 1fr", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={{ color: "var(--dim)" }}>{new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}</span>
            <span style={{ color: "var(--hot)" }}>{r.agent}</span>
            <span>{r.summary}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
