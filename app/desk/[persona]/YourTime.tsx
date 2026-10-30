"use client";
// A queued email's send time in the viewer's own zone. The server doesn't know that zone, so it fills in after load.
import { useEffect, useState } from "react";

export default function YourTime({ at }: { at: string }) {
  const [s, setS] = useState<string | null>(null);
  useEffect(() => { setS(new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(at))); }, [at]);
  return s ? <> ({s} your time)</> : null;
}
