import { notFound, permanentRedirect } from "next/navigation";
import { sql } from "@/lib/db";
import { resolve, pathFor } from "@/lib/slug";
import { showSimulated } from "@/lib/floor";
import { Logo, AgentChip } from "../../components/visuals";

export const dynamic = "force-dynamic";

type Row = {
  id: string; class: string; body: string; answer: string | null; simulated: boolean; created_at: string;
  detail: { summary?: string; questions?: string[]; queries?: { tool: string; input: unknown; output: unknown }[]; acted?: string[]; revisit?: string };
  touch_id: string; contact_name: string | null; contact_role: string; account_id: string; account_name: string; touch_slug: string | null; account_slug: string | null;
};

const CLASS: Record<string, { label: string; color: string; meaning: string }> = {
  interested: { label: "INTERESTED", color: "#2fd39a", meaning: "Answered with fresh Qloo data, then handed to a person. The agents don't book meetings." },
  not_now: { label: "NOT NOW", color: "#ffb31f", meaning: "Sequence stopped. A date is set to look again." },
  referral: { label: "REFERRAL", color: "#5aa2ff", meaning: "Sequence stopped. The person they named became a new contact and the Writer drafted to them." },
  opt_out: { label: "OPT-OUT", color: "#ff8080", meaning: "Do-not-contact added and every unsent message cancelled. No reply sent." },
  ooo: { label: "OUT OF OFFICE", color: "#a99cff", meaning: "Follow-ups moved past the return date. No reply sent." },
  other: { label: "OTHER", color: "#9b93c9", meaning: "Sequence stopped; questions answered if there were any." },
};

const short = (v: unknown) => { const s = JSON.stringify(v); return s.length > 420 ? s.slice(0, 420) + "…" : s; };

export default async function Reply({ params }: { params: Promise<{ id: string }> }) {
  const { id: key } = await params;
  const hit = await resolve("replies", key);
  if (!hit) notFound();
  if (hit.redirect) permanentRedirect(hit.redirect);
  const id = hit.id;
  const [r] = (await sql()`
    select r.*, t.id touch_id, t.slug touch_slug, c.name contact_name, c.role contact_role, ac.id account_id, ac.slug account_slug, e.name account_name
    from replies r join touches t on t.id = r.touch_id join contacts c on c.id = t.contact_id
    join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id where r.id = ${id}`) as Row[];
  if (!r || (r.simulated && !showSimulated())) notFound();
  const k = CLASS[r.class] ?? CLASS.other;
  const queries = r.detail.queries ?? [];

  return (
    <main className="wrap">
      <nav className="nav"><Logo /><span className="crumb">REPLY · {r.account_name}</span></nav>
      {r.simulated && (
        <p className="band" style={{ display: "inline-block", background: "#ffb31f22", color: "#ffb31f", border: "1px solid #ffb31f88", marginTop: 8 }}>
          SIMULATED REPLY · a test written to exercise the Inbox agent, not from {r.account_name}
        </p>
      )}
      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16, marginTop: 12 }} className="split">
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <article className="panel fade-up" style={{ padding: 24 }}>
            <p className="eyebrow">From {r.contact_name ?? r.contact_role}, {r.account_name}</p>
            {/* A real person's reply is private correspondence: the public page shows the Inbox agent's one-line
                summary, never their words. Only test replies, which nobody sent, are shown in full. */}
            {r.simulated
              ? <div style={{ whiteSpace: "pre-wrap", fontSize: 15.5, lineHeight: 1.65 }}>{r.body}</div>
              : <div style={{ fontSize: 15.5, lineHeight: 1.65 }}>{r.detail.summary ?? "A reply arrived."} <span style={{ color: "var(--mute)", fontSize: 13 }}>(The reply itself stays private.)</span></div>}
          </article>
          {r.answer && (
            <article className="panel fade-up" style={{ padding: 24, animationDelay: "80ms" }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                <AgentChip agent="inbox" label="Answer by Inbox" />
                <span className="band" style={{ background: "#ffb31f22", color: "#ffb31f", border: "1px solid #ffb31f88" }}>DRY RUN · NOT SENT</span>
              </div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 15.5, lineHeight: 1.65 }}>{r.answer}</div>
            </article>
          )}
          {queries.length > 0 && (
            <article className="panel fade-up" style={{ padding: 24, animationDelay: "120ms" }}>
              <p className="eyebrow">Fresh Qloo queries behind the answer ({queries.length})</p>
              <div style={{ display: "grid", gap: 12, fontFamily: "var(--mono)", fontSize: 12.5 }}>
                {queries.map((q, i) => (
                  <div key={i} style={{ borderLeft: "2px solid var(--line)", paddingLeft: 12, overflowWrap: "anywhere" }}>
                    <div style={{ color: "var(--cyan)" }}>{q.tool}({short(q.input)})</div>
                    <div style={{ color: "var(--mute)" }}>{short(q.output)}</div>
                  </div>
                ))}
              </div>
            </article>
          )}
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="panel fade-up" style={{ padding: 24, animationDelay: "60ms" }}>
            <p className="eyebrow">Sorted as</p>
            <span className="band" style={{ background: `${k.color}22`, color: k.color, border: `1px solid ${k.color}88` }}>{k.label}</span>
            <p style={{ fontSize: 14, margin: "12px 0 0" }}>{r.detail.summary}</p>
            <p style={{ color: "var(--mute)", fontSize: 13, margin: "10px 0 0" }}>{k.meaning}</p>
          </div>
          {(r.detail.acted?.length ?? 0) > 0 && (
            <div className="panel fade-up" style={{ padding: 24, animationDelay: "100ms", display: "grid", gap: 6, fontSize: 14 }}>
              <p className="eyebrow" style={{ marginBottom: 4 }}>What the Inbox agent did</p>
              {r.detail.acted!.map((a, i) => <span key={i}>✓ {a}</span>)}
            </div>
          )}
          <div className="panel fade-up" style={{ padding: 24, animationDelay: "140ms", display: "grid", gap: 8, fontSize: 14 }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Trail</p>
            <a href={pathFor("touches", r.touch_slug, r.touch_id)}>The message they replied to →</a>
            <a href={pathFor("accounts", r.account_slug, r.account_id)}>Account: {r.account_name} →</a>
            <span style={{ color: "var(--dim)", fontSize: 13 }}>Received {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
          </div>
        </div>
      </section>
    </main>
  );
}
