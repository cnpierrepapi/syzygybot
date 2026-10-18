"use client";

// The homepage legend doubles as a filter: click a type or a line band to isolate it in the sky, click again to clear.
import { useEffect, useState } from "react";
import { filterSky } from "@/lib/sky";

type Item = { key: string; label: string; color: string; filter: { type: string } | { band: string } };

export default function SkyLegend({ items }: { items: Item[] }) {
  const [on, setOn] = useState<string | null>(null);
  useEffect(() => () => { filterSky(null); }, []); // leaving the page clears it
  return (
    <div className="legend" role="group" aria-label="Show only">
      {items.map(it => {
        const active = on === it.key;
        return (
          <button key={it.key} type="button" className="chip legend-chip" aria-pressed={active}
            onClick={() => { const next = active ? null : it.key; setOn(next); filterSky(next ? it.filter : null); }}
            style={active ? { borderColor: it.color, background: `${it.color}2e`, color: "#efeaff", boxShadow: `0 0 12px ${it.color}55` } : undefined}>
            <i style={{ background: it.color, boxShadow: `0 0 8px ${it.color}` }} />{it.label}
          </button>
        );
      })}
    </div>
  );
}
