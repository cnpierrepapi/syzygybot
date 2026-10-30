"use client";
// A time in the viewer's own zone. The server doesn't know that zone, so it renders UTC and swaps after load.
import { useEffect, useState } from "react";

export default function Clock({ iso, seconds = false }: { iso: string; seconds?: boolean }) {
  const [s, setS] = useState<string | null>(null);
  useEffect(() => { setS(new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) })); }, [iso, seconds]);
  return <>{s ?? new Date(iso).toISOString().slice(11, seconds ? 19 : 16)}</>;
}
