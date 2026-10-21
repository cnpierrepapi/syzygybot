"use client";

// The desk board. Columns are the agents' steps; the agents move the cards, people don't. On open it replays the real
// run from the action log (sped up, labelled as a replay), then every card settles where it actually is now.
import { useEffect, useMemo, useState } from "react";
import type { BoardCard } from "@/lib/board";

type Col = { id: string; label: string; agents: string };

const AGENT: Record<string, string> = {
  scout: "Scout", checker: "Deal check", qualifier: "Qualifier", numbers: "Numbers", contact_finder: "Contact finder", verifier: "Verifier",
  strategist: "Strategist", writer: "Writer", sequencer: "Sequencer", inbox: "Inbox agent", clearance: "Clearance", router: "Router",
  sponsor: "Sponsor", talent: "Talent", venue: "Venue", podcast: "Podcast", watch: "Market Watch",
};
const REPLAY_MS = 32_000;   // the whole board's run, compressed
const STAGGER_MS = 1_400;   // cards start one after another

const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const initials = (n: string | null) => (n ? n.split(/\s+/).map(x => x[0]).join(". ") + "." : null);

export default function Board({ cards, columns, persona }: { cards: BoardCard[]; columns: readonly Col[]; persona: string }) {
  const [t, setT] = useState<number | null>(null); // ms into the replay, null = settled
  const key = `syz-replay:${persona}`;
  const start = () => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => { const e = performance.now() - t0; if (e >= REPLAY_MS + cards.length * STAGGER_MS) { setT(null); sessionStorage.setItem(key, "1"); return; } setT(e); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  };
  useEffect(() => { if (!sessionStorage.getItem(key) && cards.some(c => c.steps.length)) return start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // During the replay a card walks its own recorded steps up to the approval column, then lands where it is now.
  const place = useMemo(() => (c: BoardCard, i: number) => {
    if (t == null || !c.steps.length) return { col: c.col, step: c.steps[c.steps.length - 1] ?? null, live: false };
    const pre = c.steps.filter(s => s.col < 5);
    const span = REPLAY_MS / Math.max(1, Math.min(cards.length, 8));
    const local = t - i * STAGGER_MS;
    if (local < 0) return { col: -1, step: null, live: false };
    const k = Math.floor((local / span) * pre.length);
    if (k >= pre.length) return { col: c.col, step: c.steps[c.steps.length - 1], live: false };
    return { col: pre[k].col, step: pre[k], live: true };
  }, [t, cards.length]);

  const placed = cards.map((c, i) => ({ c, ...place(c, i) }));
  const replaying = t != null;

  return (
    <section className="board" aria-label="Where every card is in the agents' loop">
      <div className="board-bar">
        <div>
          <h2>The loop</h2>
          <p>The agents carry each card across. You only act in <b>Your approval</b>.</p>
        </div>
        <div className="board-bar-right">
          {replaying ? <span className="replay-tag"><i />Recorded run, replayed</span>
            : <button className="btn quiet" type="button" onClick={() => start()}>Replay the run</button>}
        </div>
      </div>
      <div className="board-cols">
        {columns.map((col, ci) => {
          const here = placed.filter(p => p.col === ci);
          return (
            <div key={col.id} className={`board-col${ci === 5 ? " is-you" : ""}`}>
              <header><b>{col.label}</b><span>{here.length}</span></header>
              <p className="board-col-agents">{col.agents}</p>
              <div className="board-stack">
                {here.map(({ c, step, live }) => (
                  <a key={c.id} href={`#r-${c.id}`} className={`kcard${live ? " live" : ""}${c.real ? " real" : ""}`}>
                    <span className="kcard-top">
                      <span className="kcard-org">{c.org}</span>
                      {c.real && <span className="kcard-real">REAL EMAIL</span>}
                    </span>
                    <span className="kcard-who">{c.person ? `${initials(c.person)} · ` : ""}{c.channel === "email" ? "email" : "letter"}</span>
                    {step && (
                      <span className="kcard-step">
                        <b>{AGENT[step.agent] ?? step.agent}</b> {step.summary.length > 110 ? `${step.summary.slice(0, 108)}…` : step.summary}
                      </span>
                    )}
                    <span className="kcard-foot">
                      {replaying && step ? <>recorded {fmt(step.at)}</> : c.note ?? (ci === 5 ? "Waiting for you" : "")}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
