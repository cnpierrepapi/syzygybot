import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "../components/visuals";
import DeskPicker from "./DeskPicker";
import { DESKS, PERSONAS, desksFor, loadPersona } from "@/lib/personas";
import { DESK_COOKIE, openDesk } from "@/lib/desk";
import { find, setUp, SETUP_WHY, type Found } from "@/lib/live/custom";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Open a desk",
  description: "Pick a judge, or find your own brand, artist or show. SYZYGY runs the desk live on Qloo's taste data and asks before anything goes out.",
  alternates: { canonical: "/desk" },
};

async function go(personaId: string) {
  const p = await loadPersona(personaId);
  if (!p) redirect("/desk");
  const jar = await cookies();
  const r = await openDesk(p, jar.get(DESK_COOKIE)?.value);
  if (!r.ok) redirect("/desk?full=1");
  jar.set(DESK_COOKIE, r.id, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 7 * 86400, path: "/" });
  redirect(`/desk/${p.id}`);
}

async function open(fd: FormData) {
  "use server";
  await go(String(fd.get("persona")));
}

async function mine(fd: FormData) {
  "use server";
  const q = String(fd.get("q") ?? "");
  const r = await setUp(q, String(fd.get("entity") ?? ""));
  if (!r.ok) redirect(`/desk?q=${encodeURIComponent(q)}&why=${encodeURIComponent(r.why)}#yours`);
  await go(r.id);
}

const KIND: Record<Found["type"], string> = { brand: "Brand", artist: "Artist", person: "Person", tv_show: "TV show", movie: "Film", podcast: "Podcast" };
const WHAT: Record<Found["type"], string> = {
  brand: "co-brands and artist ambassadors", artist: "tour sponsors, rooms to hold and a feature", person: "brand deals and a collab",
  tv_show: "sponsors", movie: "sponsors", podcast: "ad sponsors",
};

export default async function DeskStart({ searchParams }: { searchParams: Promise<{ full?: string; q?: string; why?: string }> }) {
  const { full, q, why } = await searchParams;
  const personas = PERSONAS.map(p => ({ id: p.id, title: p.title, judge: p.judge, who: p.who, forWhom: p.forWhom, role: p.role, desks: desksFor(p), demo: p.demo }));
  const found = q ? await find(q) : null;
  return (
    <main className="wrap desk-mode" style={{ maxWidth: 820 }}>
      <nav className="nav"><Logo /><a className="crumb" href="/">← Live floor</a></nav>
      <section style={{ padding: "36px 0 22px" }}>
        <p className="eyebrow">Open a desk</p>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)", lineHeight: 1.05 }}>Pick a judge.<br /><span className="grad-text">The agents take it from there.</span></h1>
        <p style={{ color: "var(--dim)", maxWidth: 600, marginTop: 14 }}>
          Every judge has a desk written for their own business. Open one and the agents run it live: they read the audience in
          Qloo, pick who it leans toward, find the person who decides and write the pitch. Anything that would leave the building
          comes to you first, and you approve, edit, reject or park it.
        </p>
        {full && <p className="chip" style={{ color: "#b4432f", marginTop: 12 }}>Today&apos;s demo desks are all taken. Try again tomorrow.</p>}
      </section>
      <DeskPicker personas={personas}
        deskLabels={Object.fromEntries(Object.entries(DESKS).map(([k, d]) => [k, d.label]))} action={open} />

      <section id="yours" className="panel fade-up" style={{ padding: "22px 22px 24px", marginTop: 18, display: "grid", gap: 14 }}>
        <div>
          <p className="eyebrow">Or find yours</p>
          <p style={{ color: "var(--dim)", margin: 0, maxWidth: 600 }}>
            Type a brand, an artist, a person, a show or a podcast. Pick the right one from Qloo and you get a desk that reads its
            audience the same way.
          </p>
        </div>
        <form method="get" action="/desk#yours" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input name="q" defaultValue={q ?? ""} placeholder="e.g. Liquid Death, Karol G, Hot Ones" maxLength={60} required
            className="find-input" aria-label="Brand, artist, person, show or podcast" />
          <button className="btn" type="submit">Find it in Qloo</button>
        </form>
        {why && why in SETUP_WHY && <p className="chip" style={{ color: "#b4432f", margin: 0 }}>{SETUP_WHY[why as keyof typeof SETUP_WHY]}</p>}
        {q && found === null && <p className="hint" style={{ margin: 0 }}>Today&apos;s searches are used up. Try again tomorrow, or open a judge&apos;s desk.</p>}
        {q && found && !found.length && <p className="hint" style={{ margin: 0 }}>Qloo has nothing under &quot;{q}&quot; that a desk can work for. Try the full name.</p>}
        {found && found.length > 0 && (
          <ul className="find-list">
            {found.map(e => (
              <li key={e.id}>
                <form action={mine}>
                  <input type="hidden" name="q" value={q} /><input type="hidden" name="entity" value={e.id} />
                  <button type="submit" className="find-row">
                    <span><b>{e.name}</b> <span className="chip">{KIND[e.type]}</span></span>
                    {e.about && <span className="find-about">{e.about}</span>}
                    <span className="find-what">Set up a desk: {WHAT[e.type]} →</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
