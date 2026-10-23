"use client";
import { useEffect, useRef, useState } from "react";

type P = { id: string; title: string; judge: string | null; who: string; forWhom: string; role: string; desks: string[]; demo?: boolean;
  name: string; sub?: string; image: string | null };

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

// A photo on every tile: the judges', then the Bad Bunny demo, then desks visitors set up from Qloo (initials if no picture).
export default function DeskPicker({ personas, setUp, deskLabels, action }: {
  personas: P[]; setUp: P[]; deskLabels: Record<string, string>; action: (fd: FormData) => Promise<void>;
}) {
  const [id, setId] = useState<string | null>(null);
  const p = [...personas, ...setUp].find(x => x.id === id) ?? null;
  const tiles = [...personas.filter(x => x.judge), ...personas.filter(x => !x.judge)];
  const tile = (x: P) => (
    <button key={x.id} type="button" role="radio" aria-checked={x.id === id} className={`judge-tile${x.id === id ? " on" : ""}`} onClick={() => setId(x.id)}>
      {x.image
        ? <img src={x.image} alt="" width={84} height={84} />
        : <span className="judge-mono" aria-hidden>{initials(x.name)}</span>}
      <span className="judge-name">{x.name}</span>
      {x.sub && <span className="judge-sub">{x.sub}</span>}
    </button>
  );
  // On a phone the card lands below the fold; bring it and the button into view.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { if (id) card.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [id]);
  return (
    <form action={action} className="panel fade-up" style={{ padding: "22px 22px 24px", display: "grid", gap: 20 }}>
      <div>
        <p className="eyebrow">Pick a judge</p>
        <div className="judge-grid" role="radiogroup" aria-label="Pick a judge">
          {tiles.map(tile)}
        </div>
        {setUp.length > 0 && <>
          <p className="eyebrow" style={{ marginTop: 18 }}>Desks people set up</p>
          <div className="judge-grid" role="radiogroup" aria-label="Desks people set up">{setUp.map(tile)}</div>
        </>}
        {!p && <p className="hint" style={{ marginTop: 12 }}>Tap a desk to see what it works on.</p>}
      </div>
      {p && (
        <>
          <input type="hidden" name="persona" value={p.id} />
          <div className="persona-card fade-up" style={{ marginTop: 0 }}>
            {p.judge ? <span className="chip" style={{ marginBottom: 10 }}>Written for {p.judge}</span>
              : !p.demo && <span className="chip" style={{ marginBottom: 10 }}>Set up from Qloo</span>}
            <strong style={{ display: "block", fontSize: 18 }}>{p.title}</strong>
            <p style={{ margin: "6px 0 0", color: "var(--dim)" }}>{p.who} {p.forWhom}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {p.desks.map(d => <span key={d} className="chip"><i style={{ background: d === "watch" ? "#5a5aa6" : "#a86400" }} />{deskLabels[d]}</span>)}
            </div>
          </div>
          <div ref={card} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", scrollMarginBottom: 24 }}>
            <button className="btn btn-lg" type="submit">Open the desk →</button>
            <span className="hint" style={{ margin: 0 }}>No login. Nothing you approve here gets sent.</span>
          </div>
        </>
      )}
    </form>
  );
}
