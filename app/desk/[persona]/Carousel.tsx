"use client";

// The requests as one horizontal row: swipe, scroll or use the arrows. Each card snaps into place; the counter says where
// you are. New cards arriving mid-run don't move what you're reading, and a link to #r-<id> lines its card up on the left.
import { Children, useEffect, useRef, useState } from "react";

export default function Carousel({ children }: { children: React.ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const n = Children.count(children);
  const reading = useRef<Element | null>(null), lastHash = useRef("");

  const line = (kid: Element | null | undefined, behavior: ScrollBehavior = "instant") => {
    const el = track.current;
    if (el && kid) el.scrollTo({ left: (kid as HTMLElement).offsetLeft - el.offsetLeft, behavior });
  };

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => {
      const kids = [...el.children] as HTMLElement[];
      const i = kids.reduce((best, k, j) => Math.abs(k.offsetLeft - el.offsetLeft - el.scrollLeft) < Math.abs(kids[best].offsetLeft - el.offsetLeft - el.scrollLeft) ? j : best, 0);
      setAt(i);
      reading.current = i === 0 ? null : kids[i];
    };
    // The row just changed size: keep the card being read in place, or stay on the first card if that's where you were.
    if (reading.current && el.contains(reading.current)) line(reading.current);
    else el.scrollTo({ left: 0, behavior: "instant" });
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [n]);

  // Follow a new #r-<id>, again once Next has finished its own scroll.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const hash = window.location.hash.slice(1);
    if (hash === lastHash.current) return;
    lastHash.current = hash;
    const kid = hash ? [...el.children].find(k => k.id === hash) : null;
    if (!kid) return;
    line(kid);
    const t = setTimeout(() => line(kid), 150);
    return () => clearTimeout(t);
  });

  const go = (d: number) => line(track.current?.children[Math.min(n - 1, Math.max(0, at + d))], "smooth");
  if (!n) return null;
  return (
    <div className="carousel">
      <div className="carousel-bar">
        <span className="carousel-count">{Math.min(at + 1, n)} of {n}</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn quiet" type="button" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous request">←</button>
          <button className="btn quiet" type="button" onClick={() => go(1)} disabled={at >= n - 1} aria-label="Next request">→</button>
        </span>
      </div>
      <div ref={track} className="carousel-track">{children}</div>
    </div>
  );
}
