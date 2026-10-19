"use client";
import { useState } from "react";

type P = { id: string; title: string; judge: string | null; who: string; forWhom: string; role: string; desks: string[]; demo?: boolean };
type Role = { id: string; label: string };

export default function DeskPicker({ personas, roles, deskLabels, action }: {
  personas: P[]; roles: Role[]; deskLabels: Record<string, string>; action: (fd: FormData) => Promise<void>;
}) {
  const demo = personas.find(p => p.demo) ?? personas[0];
  const [role, setRole] = useState(demo.role);
  const [id, setId] = useState(demo.id);
  const p = personas.find(x => x.id === id) ?? demo;
  const pick = (r: string) => {
    setRole(r);
    if (p.role !== r) { const first = personas.find(x => x.role === r); if (first) setId(first.id); }
  };
  return (
    <form action={action} className="panel fade-up" style={{ padding: "22px 22px 24px", display: "grid", gap: 22 }}>
      <div>
        <p className="eyebrow">1 · What do you do?</p>
        <div className="role-grid">
          {roles.map(r => (
            <button key={r.id} type="button" className={`role-chip${r.id === role ? " on" : ""}`} aria-pressed={r.id === role} onClick={() => pick(r.id)}>{r.label}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="eyebrow">2 · Who do you do it for?</p>
        <label className="field">
          <span className="sr-only">Persona</span>
          <select name="persona" value={id} onChange={e => { setId(e.target.value); setRole(personas.find(x => x.id === e.target.value)!.role); }}>
            {personas.map(x => (
              <option key={x.id} value={x.id}>{x.title}{x.demo ? "  (the demo)" : x.judge ? `  (for ${x.judge})` : ""}</option>
            ))}
          </select>
        </label>
        <div className="persona-card">
          {p.judge && <span className="chip" style={{ marginBottom: 10 }}>Written for {p.judge}</span>}
          <strong style={{ display: "block", fontSize: 18 }}>{p.title}</strong>
          <p style={{ margin: "6px 0 0", color: "var(--dim)" }}>{p.who} {p.forWhom}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            {p.desks.map(d => <span key={d} className="chip"><i style={{ background: d === "watch" ? "#22d3ee" : "#ffb020" }} />{deskLabels[d]}</span>)}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button className="btn" type="submit">Open the desk →</button>
        <span className="hint" style={{ margin: 0 }}>No login. Nothing you approve here gets sent.</span>
      </div>
    </form>
  );
}
