"use client";

// The constellation, retrofitted: it lives inside one dark rounded card (Qloo-style hero) instead of behind every page.
import dynamic from "next/dynamic";

const Constellation = dynamic(() => import("./Constellation"), { ssr: false });

export default function SkyCard({ children, className = "", tall = false }: { children: React.ReactNode; className?: string; tall?: boolean }) {
  return (
    <section className={`sky-card${tall ? " tall" : ""} ${className}`}>
      <div className="sky-card-bg" aria-hidden><Constellation /></div>
      <div className="sky-card-body">{children}</div>
    </section>
  );
}
