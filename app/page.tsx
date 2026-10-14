import { sql } from "@/lib/db";
import { feed, funnel, type FeedItem, type Funnel } from "@/lib/floor";
import LiveFloor from "./components/LiveFloor";
import { jsonLd, siteJsonLd } from "@/lib/seo";
import type { Metadata } from "next";

// Only the floor itself claims "/" as its canonical address; every other page sets its own or none.
export const metadata: Metadata = { alternates: { canonical: "/" } };
import { Logo } from "./components/visuals";
import { typeColors } from "@/lib/ui";

export const dynamic = "force-dynamic";

type Card = { id: string; slug: string | null; score: number; band: string; thesis: string | null; a_name: string; a_type: string; b_name: string; b_type: string };

async function load() {
  if (!process.env.DATABASE_URL) return { items: [] as FeedItem[], counts: [] as Funnel, cards: [] as Card[] };
  try {
    const [items, counts, cards] = await Promise.all([
      feed(40),
      funnel(),
      sql()`
        select p.id, p.slug, p.score, p.band, p.thesis, a.name a_name, a.type a_type, b.name b_name, b.type b_type
        from pairs p join entities a on a.qloo_id = p.a_id join entities b on b.qloo_id = p.b_id
        where p.band = 'PITCH' and p.thesis is not null
        order by p.called_at desc, p.score desc limit 4`.then(r => r as Card[]),
    ]);
    return { items, counts, cards };
  } catch {
    return { items: [] as FeedItem[], counts: [] as Funnel, cards: [] as Card[] };
  }
}

const LEGEND: [string, string][] = [["brand", "Brands"], ["artist", "Artists"], ["tv_show", "TV shows"], ["movie", "Films"]];

function Hero() {
  return (
    <section className="hero">
      <div className="fade-up" style={{ maxWidth: 680 }}>
        <p className="eyebrow"><span className="live-dot" style={{ marginRight: 10 }} />AI sales team · built on Qloo taste data</p>
        <h1 className="headline" style={{ fontSize: "clamp(34px, 4.6vw, 58px)", lineHeight: 1.02 }}>
          <span>Finds the brands</span><span>your fans already <span className="grad-text" style={{ display: "inline" }}>love</span>.</span><span>Then pitches them.</span>
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 16.5, maxWidth: 560, marginTop: 18 }}>
          Each star is a brand, artist or show. Each line is a thesis: two audiences that line up in a way nobody has
          noticed. The ten agents ride the outer ring, and every time one of them acts, you see it cross the sky.
        </p>
        <div className="legend">
          {LEGEND.map(([t, label]) => {
            const [c] = typeColors(t);
            return <span key={t} className="chip"><i style={{ background: c, boxShadow: `0 0 8px ${c}` }} />{label}</span>;
          })}
          <span className="chip"><i style={{ background: "#ffb020" }} />PITCH line</span>
          <span className="chip"><i style={{ background: "#5b6fd6" }} />WATCH line</span>
        </div>
        <p className="hint">Hover a star for its name. Click it to open its account or thesis.</p>
      </div>
    </section>
  );
}

function Featured({ cards }: { cards: Card[] }) {
  if (!cards.length) return null;
  return (
    <section style={{ marginTop: 40 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 20 }}>Latest PITCH theses</h2>
        <span className="eyebrow" style={{ margin: 0 }}>scored by Scout</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        {cards.map((c, i) => {
          const [ca] = typeColors(c.a_type), [cb] = typeColors(c.b_type);
          return (
            <a key={c.id} href={`/thesis/${c.slug ?? c.id}`} className="panel fade-up" style={{ padding: 18, display: "block", animationDelay: `${i * 70}ms` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <i style={{ width: 9, height: 9, borderRadius: "50%", background: ca, boxShadow: `0 0 10px ${ca}`, flex: "none" }} />
                <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${ca}, #ffb020, ${cb})`, opacity: 0.7 }} />
                <i style={{ width: 9, height: 9, borderRadius: "50%", background: cb, boxShadow: `0 0 10px ${cb}`, flex: "none" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 14, gap: 8 }}>
                <strong style={{ fontSize: 16.5, lineHeight: 1.25 }}>{c.a_name} <span style={{ color: "var(--mute)" }}>×</span> {c.b_name}</strong>
                <span className={`band band-${c.band}`}>{c.score.toFixed(2)}</span>
              </div>
              <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "10px 0 0", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.thesis}</p>
            </a>
          );
        })}
      </div>
    </section>
  );
}

export default async function Floor() {
  const { items, counts, cards } = await load();
  return (
    <main className="wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(siteJsonLd())} />
      <nav className="nav">
        <Logo />
        <span className="crumb">SDR FLOOR · syzygybot.vercel.app</span>
      </nav>
      <Hero />
      <LiveFloor initialItems={items} initialFunnel={counts} middle={<Featured cards={cards} />} />
      <p style={{ color: "var(--mute)", fontSize: 12.5, marginTop: 28, maxWidth: 760 }}>
        Scores describe aggregate audience affinity from Qloo taste data, not individuals, and say nothing about what a
        partnership would cause. Contact details are masked on this public page.
      </p>
    </main>
  );
}
