"use client";

// The live desk board. Opening the desk starts the persona's run (or joins the one going), and the board polls it: a card
// moves only when an agent has really finished a step, and it holds each column for at least 5 seconds so you can read
// what happened. The panel under the board says what the agents just did. People don't move cards.
import { useEffect, useRef, useState } from "react";
import type { RunCard, RunSnapshot, RunStep } from "@/lib/live/run";

const COLS = [
  { label: "Spotted", agents: "Scout, desk agents" },
  { label: "Checked", agents: "Numbers, Deal check" },
  { label: "Person found", agents: "Contact finder" },
  { label: "Drafted", agents: "Writer" },
  { label: "Clearance", agents: "Clearance" },
  { label: "Your approval", agents: "You" },
];
const AGENT: Record<string, string> = {
  scout: "Scout", checker: "Deal check", numbers: "Numbers", contact_finder: "Contact finder", writer: "Writer", clearance: "Clearance",
  sponsor: "Sponsor", talent: "Talent", podcast: "Podcast", venue: "Venue", router: "Router", sequencer: "Sequencer",
};
const HOLD_MS = 5_000, POLL_MS = 2_500;

type Shown = { idx: number; at: number };
type Line = { key: string; who: string; agent: string; col: number | null; summary: string; at: string };

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const mins = (a: string, b: string | null) => { const s = Math.round(((b ? +new Date(b) : Date.now()) - +new Date(a)) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

export default function LiveBoard({ persona }: { persona: string }) {
  const [snap, setSnap] = useState<RunSnapshot | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, Shown>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const runId = useRef<string | null>(null), joined = useRef(false), logged = useRef(new Set<string>());

  const begin = async (again = false) => {
    const r = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona, again }) }).then(x => x.json()).catch(() => null);
    if (!r?.id) { setWhy(r?.why ?? "The run couldn't start. Reload to try again."); return; }
    // Joining a run already under way: what it did before you came shows at once; only new steps play out.
    joined.current = !r.fresh;
    runId.current = r.id; logged.current = new Set(); setShown({}); setLines([]); setSnap(null); setWhy(null);
  };
  useEffect(() => { begin(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll the run until it's finished.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (!runId.current) return;
      const s = (await fetch(`/api/run/${runId.current}`, { cache: "no-store" }).then(x => x.json()).catch(() => null)) as RunSnapshot | null;
      if (stop || !s?.id || s.id !== runId.current) return;
      setSnap(s);
      if (joined.current) {
        joined.current = false;
        const now = Date.now() - HOLD_MS;
        setShown(Object.fromEntries(s.cards.map(c => [c.id, { idx: c.steps.length - 1, at: now }])));
        for (const c of s.cards) c.steps.forEach((st, i) => logged.current.add(`${c.id}:${i}`));
        setLines([...s.log, ...s.cards.flatMap(c => c.steps.map(st => ({ ...st, who: c.org })))].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
          .map((st, i) => ({ key: `j${i}`, who: "who" in st ? (st as RunStep & { who: string }).who : "", agent: st.agent, col: st.col, summary: st.summary, at: st.at })));
      }
    };
    tick();
    const t = setInterval(() => { if (snap?.status === "running" || !snap) tick(); }, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [snap?.status, snap?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pace the cards: one column at a time, each held at least 5 seconds.
  useEffect(() => {
    const t = setInterval(() => {
      if (!snap) return;
      const now = Date.now();
      const add: Line[] = [];
      setShown(prev => {
        const next = { ...prev };
        for (const c of snap.cards) {
          if (!c.steps.length) continue;
          const cur = next[c.id];
          if (!cur) { next[c.id] = { idx: 0, at: now }; continue; }
          if (cur.idx < c.steps.length - 1 && now - cur.at >= HOLD_MS) next[c.id] = { idx: cur.idx + 1, at: now };
        }
        for (const c of snap.cards) {
          const k = next[c.id] ? `${c.id}:${next[c.id].idx}` : null;
          if (k && !logged.current.has(k)) { logged.current.add(k); const st = c.steps[next[c.id].idx]; add.push({ key: k, who: c.org, agent: st.agent, col: st.col, summary: st.summary, at: st.at }); }
        }
        return next;
      });
      for (const st of snap.log) {
        const k = `run:${st.kind}:${st.at}`;
        if (logged.current.has(k)) continue;
        logged.current.add(k);
        add.push({ key: k, who: "", agent: st.agent, col: null, summary: st.summary, at: st.at });
      }
      if (add.length) setLines(prev => [...add, ...prev].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8));
    }, 500);
    return () => clearInterval(t);
  }, [snap]);

  const placed = (snap?.cards ?? []).filter(c => shown[c.id]).map(c => ({ c, st: c.steps[shown[c.id].idx] }));
  const backlog = (snap?.cards ?? []).some(c => shown[c.id] && shown[c.id].idx < c.steps.length - 1);
  const running = snap?.status === "running" || backlog;
  const lead = (focus && placed.find(p => p.c.id === focus)) || null;
  const now = lead ? { who: lead.c.org, agent: lead.st.agent, col: lead.st.col, summary: lead.st.summary, at: lead.st.at } : lines[0];

  const working = (c: RunCard, col: number) => c.status === "working" && shown[c.id]?.idx === c.steps.length - 1 && col < 5;

  return (
    <section className="board" aria-label="The agents' live run">
      <div className="board-bar">
        <div>
          <h2>The loop</h2>
          <p>The agents carry each card across as they work. You only act in <b>Your approval</b>.</p>
        </div>
        <div className="board-bar-right">
          {!snap && !why && <span className="replay-tag"><i />Starting the agents</span>}
          {why && <span className="replay-tag">{why}</span>}
          {snap && running && <span className="replay-tag live-tag"><i />Live run · {mins(snap.started_at, null)}</span>}
          {snap && !running && (
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="replay-tag">{snap.status === "done" ? `Run finished in ${mins(snap.started_at, snap.finished_at)}` : "Run stopped early"} · {snap.qloo_calls} Qloo calls</span>
              <a className="btn" href={`/desk/${persona}/report/${snap.id}`} target="_blank" rel="noopener">Open the report ↗</a>
              <button className="btn quiet" type="button" onClick={() => begin(true)}>Run it again</button>
            </span>
          )}
        </div>
      </div>
      <div className="board-cols live-cols">
        {COLS.map((col, ci) => {
          const here = placed.filter(p => (p.st.col ?? 0) === ci);
          return (
            <div key={col.label} className={`board-col${ci === 5 ? " is-you" : ""}`}>
              <header><b>{col.label}</b><span>{here.length}</span></header>
              <p className="board-col-agents">{col.agents}</p>
              <div className="board-stack">
                {here.map(({ c, st }) => {
                  const fresh = Date.now() - (shown[c.id]?.at ?? 0) < HOLD_MS;
                  return (
                    <button key={c.id} type="button" onClick={() => setFocus(focus === c.id ? null : c.id)}
                      className={`kcard${fresh && running ? " live" : ""}${focus === c.id ? " picked" : ""}${c.status === "dropped" ? " dropped" : ""}`}>
                      <span className="kcard-top"><span className="kcard-org">{c.org}</span></span>
                      <span className="kcard-who">{c.title}</span>
                      <span className="kcard-step"><b>{AGENT[st.agent] ?? st.agent}</b> {st.summary.length > 120 ? `${st.summary.slice(0, 118)}…` : st.summary}</span>
                      <span className="kcard-foot">
                        {c.status === "dropped" ? "Dropped" : working(c, ci) ? <span className="working">{COLS[Math.min(5, ci + 1)].agents} working…</span> : ci === 5 ? "Waiting for you" : clock(st.at)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="stage panel" aria-live="polite">
        <div className="stage-now">
          <p className="eyebrow" style={{ margin: 0 }}>{lead ? `${lead.c.org} · tap the card again to follow the run` : "What just happened"}</p>
          {now ? (
            <>
              <h3><span className="stage-agent">{AGENT[now.agent] ?? now.agent}</span>{now.col != null ? <span className="stage-col">{COLS[now.col]?.label}</span> : null}{now.who && <span className="stage-who">{now.who}</span>}</h3>
              <p>{now.summary}</p>
              <span className="stage-at">{clock(now.at)}</span>
            </>
          ) : <p>The agents are starting. The first card lands in a few seconds.</p>}
        </div>
        <ol className="stage-log">
          {lines.slice(lead ? 0 : 1).map(l => (
            <li key={l.key}><span>{clock(l.at)}</span><b>{AGENT[l.agent] ?? l.agent}</b>{l.who ? ` · ${l.who}` : ""} · {l.summary}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
