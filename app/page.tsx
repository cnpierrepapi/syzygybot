import { sql } from "@/lib/db";
import { feed, funnel, type FeedItem, type Funnel } from "@/lib/floor";
import LiveFloor from "./components/LiveFloor";
import { jsonLd, siteJsonLd } from "@/lib/seo";
import type { Metadata } from "next";

// Only the floor itself claims "/" as its canonical address; every other page sets its own or none.
export const metadata: Metadata = { alternates: { canonical: "/" } };
import { Logo } from "./components/visuals";
import SkyLegend from "./components/SkyLegend";
import { typeColors } from "@/lib/ui";
import { graph } from "@/lib/graph";
import { SOURCES } from "@/lib/sources";
import { RULE_LABEL } from "@/lib/clearance";

export const dynamic = "force-dynamic";

type Card = { id: string; slug: string | null; score: number; band: string; thesis: string | null; a_name: string; a_type: string; b_name: string; b_type: string };

async function load() {
  if (!process.env.DATABASE_URL) return { items: [] as FeedItem[], counts: [] as Funnel, cards: [] as Card[], types: [] as string[] };
  try {
    const [items, counts, cards, g] = await Promise.all([
      feed(40),
      funnel(),
      sql()`
        select p.id, p.slug, p.score, p.band, p.thesis, a.name a_name, a.type a_type, b.name b_name, b.type b_type
        from pairs p join entities a on a.qloo_id = p.a_id join entities b on b.qloo_id = p.b_id
        where p.band = 'PITCH' and p.thesis is not null
        order by p.called_at desc, p.score desc limit 4`.then(r => r as Card[]),
      graph(),
    ]);
    // The legend only offers types the sky actually has, so no filter ever isolates an empty sky.
    return { items, counts, cards, types: [...new Set(g.stars.map(s => s.type))] };
  } catch {
    return { items: [] as FeedItem[], counts: [] as Funnel, cards: [] as Card[], types: [] as string[] };
  }
}

const LEGEND: [string, string][] = [["brand", "Brands"], ["artist", "Artists"], ["tv_show", "TV shows"], ["movie", "Films"]];

type Stack = { sources: number; measured: number; rooms: number; verified: number; rules: number; waiting: number };

async function stackCounts(): Promise<Stack | null> {
  try {
    const [c] = (await sql()`select
      (select count(*) from pair_queue)::int + (select count(*) from pairs)::int measured,
      (select count(*) from venues)::int rooms,
      (select count(*) from contacts where role_status = 'confirmed')::int verified,
      (select count(*) from permission_requests r where not exists (select 1 from request_decisions d where d.request_id = r.id))::int waiting`) as Omit<Stack, "sources" | "rules">[];
    return { ...c, sources: SOURCES.length, rules: Object.keys(RULE_LABEL).length + 1 };
  } catch { return null; }
}

function Hero({ types, stack }: { types: string[]; stack: Stack | null }) {
  const n = (x: number) => x.toLocaleString("en-US");
  const steps: [string, string | null][] = stack ? [
    ["News watch", `${n(stack.sources)} sources`], ["Match scoring", `${n(stack.measured)} Qloo pairs + our own score`],
    ["Tour routing", `${n(stack.rooms)} rooms`], ["Buyers", `${n(stack.verified)} verified`], ["Writing", null],
    ["Clearance", `${stack.rules} rules`], ["Send + follow-up", null], ["Inbox", null], ["CRM", null],
  ] : [];
  return (
    <section className="hero">
      <div className="fade-up" style={{ maxWidth: 700 }}>
        <p className="eyebrow"><span className="live-dot" style={{ marginRight: 10 }} />All-in-one · fully automated · entertainment</p>
        <h1 className="headline" style={{ fontSize: "clamp(36px, 5vw, 62px)", lineHeight: 1.02 }}>
          <span>Your audience data,</span><span>finally doing</span><span className="grad-text">the work.</span>
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 17, maxWidth: 580, marginTop: 18 }}>
          Most taste data ends up in a slide deck. SYZYGY puts it on payroll. 17 agents take what an audience loves and turn it into
          booked rooms, sold sponsorships, signed ambassadors and filled ad slots. All in one place. Fully automated. Running right
          now, while you read this. You just say yes.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 22 }}>
          <a className="btn btn-lg" href="/desk">Open a desk →</a>
        </div>
        {steps.length > 0 && (
          <div className="stack-strip" aria-label="The whole stack, running now">
            <p className="eyebrow" style={{ margin: "0 0 8px" }}>The whole stack, running now</p>
            <ol>{steps.map(([k, v]) => <li key={k}><b>{k}</b>{v && <span>{v}</span>}</li>)}</ol>
          </div>
        )}
        <SkyLegend items={[
          ...LEGEND.filter(([t]) => !types.length || types.includes(t)).map(([t, label]) => ({ key: t, label, color: typeColors(t)[0], filter: { type: t } })),
          { key: "PITCH", label: "PITCH line", color: "#ffb020", filter: { band: "PITCH" } },
          { key: "WATCH", label: "WATCH line", color: "#5b6fd6", filter: { band: "WATCH" } },
        ]} />
        <p className="hint">Each star is a brand, artist or show. Each line is a match the agents are working. Click a label to show only those; hover a star for its name, click to open it.</p>
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
  const [{ items, counts, cards, types }, stack] = await Promise.all([load(), stackCounts()]);
  return (
    <main className="wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(siteJsonLd())} />
      <nav className="nav">
        <Logo />
        <span style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span className="crumb nav-hide-sm">LIVE FLOOR · syzygybot.com</span>
          <a className="btn" href="/desk" style={{ padding: "7px 16px", fontSize: 13.5 }}>Open a desk →</a>
        </span>
      </nav>
      <Hero types={types} stack={stack} />
      <div id="floor" />
      <LiveFloor initialItems={items} initialFunnel={counts} middle={<Featured cards={cards} />} />
      <p style={{ color: "var(--mute)", fontSize: 12.5, marginTop: 28, maxWidth: 760 }}>
        Match scores describe aggregate audiences, not individuals, and say nothing about what a deal would cause. Our match
        score is SYZYGY&apos;s own; where Qloo has measured a pair, Qloo&apos;s taste data confirms it. Contact details are masked on this public page.
      </p>
    </main>
  );
}
