import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "../components/visuals";
import DeskPicker from "./DeskPicker";
import { DESKS, PERSONAS, desksFor, persona } from "@/lib/personas";
import { DESK_COOKIE, openDesk } from "@/lib/desk";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Open a desk",
  description: "Pick a judge. SYZYGY opens the desk written for their business, fully automated, and asks before anything goes out.",
  alternates: { canonical: "/desk" },
};

async function open(fd: FormData) {
  "use server";
  const p = persona(String(fd.get("persona")));
  if (!p) redirect("/desk");
  const jar = await cookies();
  const r = await openDesk(p, jar.get(DESK_COOKIE)?.value);
  if (!r.ok) redirect("/desk?full=1");
  jar.set(DESK_COOKIE, r.id, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 7 * 86400, path: "/" });
  redirect(`/desk/${p.id}`);
}

export default async function DeskStart({ searchParams }: { searchParams: Promise<{ full?: string }> }) {
  const { full } = await searchParams;
  const personas = PERSONAS.map(p => ({ id: p.id, title: p.title, judge: p.judge, who: p.who, forWhom: p.forWhom, role: p.role, desks: desksFor(p), demo: p.demo }));
  return (
    <main className="wrap desk-mode" style={{ maxWidth: 820 }}>
      <nav className="nav"><Logo /><a className="crumb" href="/">← Live floor</a></nav>
      <section style={{ padding: "36px 0 22px" }}>
        <p className="eyebrow">Open a desk</p>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)", lineHeight: 1.05 }}>Pick a judge.<br /><span className="grad-text">The agents take it from there.</span></h1>
        <p style={{ color: "var(--dim)", maxWidth: 600, marginTop: 14 }}>
          Every judge has a desk written for their own business. Tap a face and SYZYGY switches on every desk that job needs. The
          agents do the research, the scoring, the contacts, the writing and the follow-up, around the clock. Anything that would
          leave the building comes to you first, and you approve, edit, reject or park it.
        </p>
        {full && <p className="chip" style={{ color: "#ff8080", marginTop: 12 }}>Today&apos;s demo desks are all taken. Try again tomorrow.</p>}
      </section>
      <DeskPicker personas={personas}
        deskLabels={Object.fromEntries(Object.entries(DESKS).map(([k, d]) => [k, d.label]))} action={open} />
    </main>
  );
}
