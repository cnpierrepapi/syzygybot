import { sql } from "@/lib/db";
import { feed, funnel, type FeedItem, type Funnel } from "@/lib/floor";
import LiveFloor from "./components/LiveFloor";
import SkyCard from "./components/SkyCard";
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
import { persona } from "@/lib/personas";

export const dynamic = "force-dynamic";

type Card = { id: string; persona: string; title: string; created_at: string; score: number; why: string | null };

async function load() {
  if (!process.env.DATABASE_URL) return { items: [] as FeedItem[], counts: [] as Funnel, cards: [] as Card[], types: [] as string[] };
  try {
    const [items, counts, cards, g] = await Promise.all([
      feed(40),
      funnel(),
      // The newest cards the live desk runs filed, one per desk, each with Qloo's two-way score.
      sql()`
        select distinct on (r.persona) r.id, r.persona, r.title, r.created_at,
          least((r.evidence->'match'->'qloo'->>'toward')::float, (r.evidence->'match'->'qloo'->>'back')::float) score,
          (select f from jsonb_array_elements_text(r.evidence->'facts') f where f like 'Qloo''s taste data%' limit 1) why
        from permission_requests r
        where r.run_id is not null and r.evidence->'match'->'qloo'->>'toward' is not null
        order by r.persona, r.created_at desc`.then(r => (r as Card[]).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 4)),
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
      (select count(*) from pairs)::int + (select count(*) from estimate_checks where qloo_toward is not null and qloo_back is not null)::int measured,
      (select count(*) from venues)::int rooms,
      (select count(*) from contacts where role_status = 'confirmed')::int verified,
      (select count(*) from permission_requests r where not exists (select 1 from request_decisions d where d.request_id = r.id))::int waiting`) as Omit<Stack, "sources" | "rules">[];
    return { ...c, sources: SOURCES.length, rules: Object.keys(RULE_LABEL).length + 1 };
  } catch { return null; }
}

function Hero({ types, stack }: { types: string[]; stack: Stack | null }) {
  const n = (x: number) => x.toLocaleString("en-US");
  // What a desk does when you open it, in order, with what's behind each step today.
  const steps: [string, string | null][] = stack ? [
    ["Qloo reads", `${n(stack.measured)} pairs measured both ways`], ["Deal check", null], ["Buyers", `${n(stack.verified)} confirmed`],
    ["Writing", null], ["Clearance", `${stack.rules} rules`], ["Your approval", `${n(stack.waiting)} waiting`],
  ] : [];
  return (
    <section className="hero">
      <div className="fade-up" style={{ maxWidth: 700 }}>
        <p className="eyebrow"><span className="live-dot" style={{ marginRight: 10 }} />Live now · built on Qloo&apos;s taste data</p>
        <h1 className="headline" style={{ fontSize: "clamp(36px, 5vw, 62px)", lineHeight: 1.02 }}>
          <span>Taste data that</span><span className="grad-text">books the deal.</span>
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 17, maxWidth: 580, marginTop: 18 }}>
          A deal is any time two sides work together and split what it makes. A sponsor on a tour. An ambassador. A co-branded drop.
          A season partner for a room, or ads on a podcast.
        </p>
        <p style={{ color: "var(--dim)", fontSize: 17, maxWidth: 580, marginTop: 10 }}>
          Qloo shows whose fans lean toward whom. The agents take it from there. They find the person who decides, write the pitch
          and check it. Open a desk and watch one run. It takes about two minutes, and nothing goes out until you say yes.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 22 }}>
          <a className="btn btn-lg" href="/desk">Open a desk →</a>
        </div>
        {steps.length > 0 && (
          <div className="stack-strip" aria-label="The whole stack, running now">
            <p className="eyebrow" style={{ margin: "0 0 8px" }}>What runs when you open a desk</p>
            <ol>{steps.map(([k, v]) => <li key={k}><b>{k}</b>{v && <span>{v}</span>}</li>)}</ol>
          </div>
        )}
        <SkyLegend items={[
          ...LEGEND.filter(([t]) => !types.length || types.includes(t)).map(([t, label]) => ({ key: t, label, color: typeColors(t)[0], filter: { type: t } })),
          { key: "PITCH", label: "PITCH line", color: "#ffb020", filter: { band: "PITCH" } },
          { key: "WATCH", label: "WATCH line", color: "#5b6fd6", filter: { band: "WATCH" } },
        ]} />
        <p className="hint">Each star is a brand, artist or show. Each line is a pair the agents worked. Click a label to show only those. Hover a star for its name, click to open it.</p>
      </div>
    </section>
  );
}

function Featured({ cards }: { cards: Card[] }) {
  if (!cards.length) return null;
  return (
    <section style={{ marginTop: 40 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 20 }}>Fresh off the desks</h2>
        <span className="eyebrow" style={{ margin: 0 }}>Qloo score, out of 1</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        {cards.map((c, i) => (
          <a key={c.id} href={`/desk/${c.persona}`} className="panel fade-up" style={{ padding: 18, display: "block", animationDelay: `${i * 70}ms` }}>
            <span className="eyebrow" style={{ margin: 0 }}>{persona(c.persona)?.title ?? c.persona}</span>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 10, gap: 8 }}>
              <strong style={{ fontSize: 16.5, lineHeight: 1.25 }}>{c.title}</strong>
              <span className="band band-PITCH">{c.score.toFixed(2)}</span>
            </div>
            {c.why && <p style={{ color: "var(--dim)", fontSize: 13.5, margin: "10px 0 0", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.why.replace(/^Qloo's taste data, read today: (.)/, (_, x: string) => x.toUpperCase())}</p>}
          </a>
        ))}
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
          <span className="crumb nav-hide-sm">Live floor</span>
          <a className="btn" href="/desk" style={{ padding: "7px 16px", fontSize: 13.5 }}>Open a desk →</a>
        </span>
      </nav>
      <SkyCard tall grow><Hero types={types} stack={stack} /></SkyCard>
      <div id="floor" />
      <LiveFloor initialItems={items} initialFunnel={counts} middle={<Featured cards={cards} />} />
      <p style={{ color: "var(--mute)", fontSize: 12.5, marginTop: 28, maxWidth: 760 }}>
        Scores are Qloo&apos;s and describe whole audiences, not people. They say who leans toward whom, not what a deal would sell.
        SYZYGY&apos;s own number is a rough estimate, used only where Qloo hasn&apos;t measured a pair. Contact details are masked here.
      </p>
    </main>
  );
}
