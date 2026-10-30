"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedItem, Funnel } from "@/lib/floor";
import { agentColor, AGENT_LABEL } from "@/lib/ui";
import { pulse } from "@/lib/sky";
import Clock from "./Clock";

const POLL_MS = 5000;
const CHAR_MS = 14;       // typewriter speed for arriving actions
const INTRO = 10;         // on load, replay the newest N actions as if they were arriving

function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now(), a = from.current, d = 900;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / d);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}

export function FunnelBar({ initial, live }: { initial: Funnel; live?: Funnel }) {
  const data = live ?? initial;
  return (
    <div className="funnel">
      {data.map((f, i) => {
        const c = agentColor(f.agent), on = f.value > 0;
        return (
          <a key={f.label} href={f.href} className="panel fade-up funnel-tile" style={{ padding: "14px 16px", animationDelay: `${i * 60}ms`, borderColor: on ? `${c}55` : undefined, opacity: on ? 1 : 0.55 }}>
            <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: on ? "var(--fg)" : "var(--dim)" }}>
              <CountUp value={f.value} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: "var(--dim)" }}>
              <i style={{ width: 7, height: 7, borderRadius: "50%", background: c, display: "block", flex: "none" }} />
              {f.label}
            </div>
          </a>
        );
      })}
    </div>
  );
}

type Shown = FeedItem & { typed: number; fresh: boolean };

export default function LiveFloor({ initialItems, initialFunnel, middle }: { initialItems: FeedItem[]; initialFunnel: Funnel; middle?: React.ReactNode }) {
  // Older history renders at once; the newest INTRO items are queued and typed out on load.
  const [rows, setRows] = useState<Shown[]>(() => initialItems.slice(INTRO).map(i => ({ ...i, typed: i.summary.length, fresh: false })));
  const queue = useRef<FeedItem[]>(initialItems.slice(0, INTRO).reverse());
  const latest = useRef<string | undefined>(initialItems[0]?.created_at);
  // Every id ever shown or queued, so a line can never appear twice.
  const seen = useRef(new Set(initialItems.map(i => i.id)));
  const typing = useRef(false);
  const [counts, setCounts] = useState<Funnel>(initialFunnel);
  const [status, setStatus] = useState<"live" | "offline">("live");

  // Print queued items one at a time, newest on top.
  useEffect(() => {
    const t = setInterval(() => {
      if (typing.current || !queue.current.length) return;
      const item = queue.current.shift()!;
      typing.current = true;
      setRows(r => [{ ...item, typed: 0, fresh: true }, ...r].slice(0, 60));
      pulse(item.agent, item.stars ?? []); // the same action, as light crossing the sky
      let n = 0;
      const tick = setInterval(() => {
        n = Math.min(item.summary.length, n + 2);
        setRows(r => r.map(x => (x.id === item.id ? { ...x, typed: n } : x)));
        if (n >= item.summary.length) { clearInterval(tick); typing.current = false; }
      }, CHAR_MS * 2);
    }, 120);
    return () => clearInterval(t);
  }, []);

  // Poll for actions newer than the last one seen.
  useEffect(() => {
    const poll = async () => {
      try {
        const q = latest.current ? `?after=${encodeURIComponent(latest.current)}` : "";
        const res = await fetch(`/api/feed${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { items: FeedItem[]; funnel: Funnel };
        setCounts(j.funnel);
        setStatus("live");
        const fresh = j.items.filter(i => !seen.current.has(i.id));
        fresh.forEach(i => seen.current.add(i.id));
        if (j.items.length) latest.current = j.items[0].created_at;
        if (fresh.length) queue.current.push(...[...fresh].reverse());
      } catch { setStatus("offline"); }
    };
    // No polling while the tab is in the background.
    const t = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <FunnelBar initial={initialFunnel} live={counts} />
      {middle}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, margin: "44px 0 14px" }}>
        <h2 style={{ fontSize: 22 }}>Live agent feed</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", fontFamily: "var(--mono)", fontSize: 12, color: "var(--dim)" }}>
          <span className="chip">{status === "live" ? <span className="live-dot" /> : <i style={{ background: "#e66767" }} />}{status === "live" ? "LIVE" : "RECONNECTING"}</span>
        </div>
      </div>

      <div className="panel" style={{ overflow: "hidden" }}>
        {rows.length === 0 && <p style={{ padding: 16, color: "var(--dim)", margin: 0 }}>The floor is quiet. No agent has acted yet.</p>}
        {rows.map(r => {
          const c = agentColor(r.agent);
          const done = r.typed >= r.summary.length;
          const text = r.summary.slice(0, r.typed);
          return (
            <div key={r.id} className={`feed-row${r.fresh ? " fresh" : ""}`} style={{ boxShadow: r.fresh && !done ? `inset 3px 0 0 ${c}` : `inset 3px 0 0 ${c}55` }}>
              <span className="feed-time"><Clock iso={r.created_at} seconds /></span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg)" }}>
                <i style={{ width: 8, height: 8, borderRadius: "50%", background: c, display: "block" }} />
                {AGENT_LABEL[r.agent] ?? r.agent}
              </span>
              <span>
                {r.href && done ? <a href={r.href}>{text} <span style={{ color: c }}>→</span></a> : text}
                {!done && <span className="cursor" />}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
