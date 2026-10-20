"use client";
import { useEffect, useRef, useState } from "react";

type P = { id: string; title: string; judge: string | null; who: string; forWhom: string; role: string; desks: string[]; demo?: boolean };

// One photo per judge; the demo persona has no judge, so it gets a monogram tile at the end.
export default function DeskPicker({ personas, deskLabels, action }: {
  personas: P[]; deskLabels: Record<string, string>; action: (fd: FormData) => Promise<void>;
}) {
  const [id, setId] = useState<string | null>(null);
  const p = personas.find(x => x.id === id) ?? null;
  const tiles = [...personas.filter(x => x.judge), ...personas.filter(x => !x.judge)];
  // On a phone the card lands below the fold; bring it and the button into view.
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { if (id) card.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [id]);
  return (
    <form action={action} className="panel fade-up" style={{ padding: "22px 22px 24px", display: "grid", gap: 20 }}>
      <div>
        <p className="eyebrow">Pick a judge</p>
        <div className="judge-grid" role="radiogroup" aria-label="Pick a judge">
          {tiles.map(x => (
            <button key={x.id} type="button" role="radio" aria-checked={x.id === id} className={`judge-tile${x.id === id ? " on" : ""}`} onClick={() => setId(x.id)}>
              {x.judge
                ? <img src={`/judges/${x.id}.jpg`} alt="" width={84} height={84} />
                : <span className="judge-mono" aria-hidden>BB</span>}
              <span className="judge-name">{x.judge ?? "Bad Bunny's team"}</span>
              {!x.judge && <span className="judge-sub">the demo</span>}
            </button>
          ))}
        </div>
        {!p && <p className="hint" style={{ marginTop: 12 }}>Tap a judge to see the desk written for them.</p>}
      </div>
      {p && (
        <>
          <input type="hidden" name="persona" value={p.id} />
          <div className="persona-card fade-up" style={{ marginTop: 0 }}>
            {p.judge && <span className="chip" style={{ marginBottom: 10 }}>Written for {p.judge}</span>}
            <strong style={{ display: "block", fontSize: 18 }}>{p.title}</strong>
            <p style={{ margin: "6px 0 0", color: "var(--dim)" }}>{p.who} {p.forWhom}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {p.desks.map(d => <span key={d} className="chip"><i style={{ background: d === "watch" ? "#22d3ee" : "#ffb020" }} />{deskLabels[d]}</span>)}
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
