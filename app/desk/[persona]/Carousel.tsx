"use client";

// The requests as one horizontal row: swipe, scroll or use the arrows. Each card snaps into place; the counter says where
// you are. A link to #r-<id> (from the board) still scrolls its card into view.
import { Children, useEffect, useRef, useState } from "react";

export default function Carousel({ children }: { children: React.ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const n = Children.count(children);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => {
      const kids = [...el.children] as HTMLElement[];
      const left = el.scrollLeft + 8;
      setAt(Math.max(0, kids.findLastIndex(k => k.offsetLeft - el.offsetLeft <= left)));
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [n]);
  const go = (d: number) => {
    const el = track.current, kid = el?.children[Math.min(n - 1, Math.max(0, at + d))] as HTMLElement | undefined;
    if (el && kid) el.scrollTo({ left: kid.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };
  if (!n) return null;
  return (
    <div className="carousel">
      <div className="carousel-bar">
        <span className="carousel-count">{at + 1} of {n}</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn quiet" type="button" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous request">←</button>
          <button className="btn quiet" type="button" onClick={() => go(1)} disabled={at >= n - 1} aria-label="Next request">→</button>
        </span>
      </div>
      <div ref={track} className="carousel-track">{children}</div>
    </div>
  );
}
