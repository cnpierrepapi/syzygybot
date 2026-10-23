"use client";

// The constellation, retrofitted: it lives inside one dark rounded card (Qloo-style hero) instead of behind every page.
// The front page's card (grow) starts inset like the rest of the page and widens edge to edge as you scroll, as on qloo.com;
// its sky sits right of the copy (split) so the stars never run under the headline.
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

const Constellation = dynamic(() => import("./Constellation"), { ssr: false });

export default function SkyCard({ children, className = "", tall = false, grow = false }: { children: React.ReactNode; className?: string; tall?: boolean; grow?: boolean }) {
  const bleed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bleed.current;
    if (!grow || !el) return;
    let raf = 0;
    const set = () => { raf = 0; el.style.setProperty("--p", String(Math.min(1, Math.max(0, scrollY / 320)))); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(set); };
    set();
    addEventListener("scroll", onScroll, { passive: true });
    return () => { removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [grow]);
  const card = (
    <section className={`sky-card${tall ? " tall" : ""}${grow ? " split-sky" : ""} ${className}`}>
      <div className="sky-card-bg" aria-hidden><Constellation /></div>
      <div className="sky-card-body">{children}</div>
    </section>
  );
  return grow ? <div ref={bleed} className="hero-bleed">{card}</div> : card;
}
