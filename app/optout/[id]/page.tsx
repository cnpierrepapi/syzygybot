import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { maskEmail } from "@/lib/ui";
import { logAction } from "@/lib/actions";
import { stopSequence } from "@/lib/sequencer";
import { Logo } from "../../components/visuals";

// About a person, or a working document: visible on the floor, kept out of search results.
export const metadata: Metadata = { title: "Opt out", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

type Row = { id: string; to_address: string | null; contact_id: string; company: string; site: string | null };

// Only the recipient has the token (it's in their copy of the message, and masked on every public page),
// so only they can opt out. Message UUIDs are not accepted: they aren't secret.
async function load(tok: string) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(tok)) return null;
  const [t] = (await sql()`
    select t.id, t.to_address, t.contact_id, e.name company, e.official_site site
    from touches t join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    where t.optout_token = ${tok}`) as Row[];
  return t ?? null;
}

// Opening the link changes nothing (mail scanners open links); the button does.
async function optOut(formData: FormData) {
  "use server";
  const t = await load(String(formData.get("id")));
  if (!t) return;
  const value = (t.to_address ?? t.site?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? t.company).toLowerCase();
  await sql()`insert into do_not_contact (value, reason) values (${value}, ${"opted out via link"}) on conflict (value) do nothing`;
  const n = t.to_address ? await stopSequence({ address: t.to_address }, "opted out") : await stopSequence({ contactId: t.contact_id }, "opted out");
  await logAction({ agent: "sequencer", kind: "optout.honoured", summary: `Opt-out from ${t.company} honoured: ${n} unsent message${n === 1 ? "" : "s"} cancelled, address added to do-not-contact.`, refTable: "touches", refId: t.id });
}

export default async function OptOut({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { id } = await params;
  const t = await load(id);
  if (!t) notFound();
  const [dnc] = (await sql()`select 1 from do_not_contact where value = lower(${t.to_address ?? ""})`) as unknown[];
  const done = !!dnc || (await searchParams).done === "1";
  return (
    <main className="wrap">
      <nav className="nav"><Logo /><span className="crumb">OPT OUT</span></nav>
      <section className="panel fade-up" style={{ padding: 32, maxWidth: 640, marginTop: 8 }}>
        {done ? (
          <>
            <h1 style={{ fontFamily: "var(--display)", fontSize: 28, margin: "0 0 12px" }}>Done. SYZYGY won't write again.</h1>
            <p style={{ color: "var(--mute)" }}>Every unsent message to {t.to_address ? maskEmail(t.to_address) : t.company} is cancelled and the address is on the do-not-contact list.</p>
          </>
        ) : (
          <form action={async (fd: FormData) => { "use server"; await optOut(fd); const { redirect } = await import("next/navigation"); redirect(`/optout/${id}?done=1`); }}>
            <h1 style={{ fontFamily: "var(--display)", fontSize: 28, margin: "0 0 12px" }}>Stop messages from SYZYGY?</h1>
            <p style={{ color: "var(--mute)", margin: "0 0 20px" }}>
              SYZYGY is an AI agent that writes to companies about Qloo taste data. One click stops every message to{" "}
              {t.to_address ? maskEmail(t.to_address) : t.company}, for good.
            </p>
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="band" style={{ cursor: "pointer", padding: "10px 18px", fontSize: 14, background: "#ff808022", color: "#ff8080", border: "1px solid #ff808088" }}>
              Stop all messages
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
