import { sql } from "@/lib/db";
import { feed, funnel, type FeedItem, type Funnel } from "@/lib/floor";
import LiveFloor from "./components/LiveFloor";
import { Alignment, Logo } from "./components/visuals";

export const dynamic = "force-dynamic";

type Card = { id: string; score: number; band: string; thesis: string | null; a_name: string; a_type: string; b_name: string; b_type: string };

async function load() {
  if (!process.env.DATABASE_URL) return { items: [] as FeedItem[], counts: [] as Funnel, cards: [] as Card[] };
  try {
    const [items, counts, cards] = await Promise.all([
      feed(40),
      funnel(),
      sql()`
        select p.id, p.score, p.band, p.thesis, a.name a_name, a.type a_type, b.name b_name, b.type b_type
        from pairs p join entities a on a.qloo_id = p.a_id join entities b on b.qloo_id = p.b_id
        where p.band = 'PITCH' and p.thesis is not null
        order by p.called_at desc, p.score desc limit 4`.then(r => r as Card[]),
    ]);
    return { items, counts, cards };
  } catch {
    return { items: [] as FeedItem[], counts: [] as Funnel, cards: [] as Card[] };
  }
}

function Hero() {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 32, alignItems: "center", padding: "28px 0 40px" }} className="hero">
      <div className="fade-up">
        <p className="eyebrow"><span className="live-dot" style={{ marginRight: 10 }} />An autonomous SDR floor · built on Qloo taste data</p>
        <h1 className="headline" style={{ fontSize: "clamp(32px, 4.4vw, 62px)", lineHeight: 1.04, letterSpacing: "-0.02em" }}>
          <span>No humans.</span><span className="grad-text">Every action here</span><span>was taken by agents.</span>
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 17, maxWidth: 560, marginTop: 18 }}>
          Scout finds two audiences that line up in a way nobody has noticed. The Qualifier picks the side that would
          buy Qloo, the Numbers agent builds its evidence, and the rest of the team works the account.
          Click any line to see the evidence behind it.
        </p>
      </div>
      <div className="fade-up" style={{ animationDelay: "150ms" }}>
        <svg viewBox="0 0 400 300" width="100%" role="img" aria-label="Three bodies moving into alignment">
          <defs>
            <radialGradient id="h1" cx="35%" cy="35%"><stop offset="0%" stopColor="#fff" /><stop offset="30%" stopColor="#ff3d9a" /><stop offset="100%" stopColor="#7a1450" /></radialGradient>
            <radialGradient id="h2" cx="35%" cy="35%"><stop offset="0%" stopColor="#fff" /><stop offset="30%" stopColor="#ffd23d" /><stop offset="100%" stopColor="#a8560f" /></radialGradient>
            <radialGradient id="h3" cx="35%" cy="35%"><stop offset="0%" stopColor="#fff" /><stop offset="30%" stopColor="#3de0ff" /><stop offset="100%" stopColor="#3a2a9e" /></radialGradient>
            <filter id="hb" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="16" /></filter>
          </defs>
          <ellipse cx="200" cy="150" rx="180" ry="62" fill="none" stroke="rgba(160,140,255,0.22)" />
          <ellipse cx="200" cy="150" rx="120" ry="40" fill="none" stroke="rgba(160,140,255,0.18)" />
          <line x1="40" y1="150" x2="360" y2="150" stroke="#ffd23d" strokeOpacity="0.55" strokeWidth="1.5" className="glow-line" />
          <circle cx="200" cy="150" r="46" fill="#ffd23d" opacity="0.35" filter="url(#hb)" />
          <circle cx="200" cy="150" r="30" fill="url(#h2)" />
          <g>
            <animateTransform attributeName="transform" type="translate" values="0,-34; 0,0; 0,0; 0,-34" keyTimes="0;0.4;0.75;1" dur="9s" repeatCount="indefinite" />
            <circle cx="70" cy="150" r="40" fill="#ff3d9a" opacity="0.4" filter="url(#hb)" />
            <circle cx="70" cy="150" r="24" fill="url(#h1)" />
          </g>
          <g>
            <animateTransform attributeName="transform" type="translate" values="0,34; 0,0; 0,0; 0,34" keyTimes="0;0.4;0.75;1" dur="9s" repeatCount="indefinite" />
            <circle cx="330" cy="150" r="40" fill="#3de0ff" opacity="0.4" filter="url(#hb)" />
            <circle cx="330" cy="150" r="24" fill="url(#h3)" />
          </g>
        </svg>
      </div>
    </section>
  );
}

function Featured({ cards }: { cards: Card[] }) {
  if (!cards.length) return null;
  return (
    <section style={{ marginTop: 44 }}>
      <h2 style={{ fontSize: 22, marginBottom: 14 }}>Latest <span className="grad-text">PITCH</span> theses</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
        {cards.map((c, i) => (
          <a key={c.id} href={`/thesis/${c.id}`} className="panel fade-up" style={{ padding: 18, display: "block", animationDelay: `${i * 80}ms`, textDecoration: "none" }}>
            <Alignment a={c.a_name} b={c.b_name} aType={c.a_type} bType={c.b_type} height={78} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8 }}>
              <strong style={{ fontSize: 17, lineHeight: 1.2 }}>{c.a_name} <span className="grad-text">×</span> {c.b_name}</strong>
              <span className={`band band-${c.band}`}>{c.score.toFixed(2)}</span>
            </div>
            <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "10px 0 0", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.thesis}</p>
          </a>
        ))}
      </div>
    </section>
  );
}

export default async function Floor() {
  const { items, counts, cards } = await load();
  return (
    <main className="wrap">
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
