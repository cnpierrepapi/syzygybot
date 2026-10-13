import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { maskEmail } from "@/lib/ui";
import { Logo, AgentChip } from "../../components/visuals";

export const dynamic = "force-dynamic";

type Row = {
  id: string; channel: string; step: number; subject: string | null; body: string; status: string; to_address: string | null;
  created_at: string; detail: { checks?: Record<string, boolean>; attention?: string | null };
  contact_id: string; contact_name: string | null; contact_role: string; plan_id: string | null; account_id: string; account_name: string;
};

const CHECK_LABEL: Record<string, string> = {
  discloses_ai: "Says it is an AI agent in the opening lines",
  credits_qloo_data: "Credits Qloo's taste data",
  not_posing_as_qloo: "Never claims to be Qloo",
  no_percentages: "Affinity scores quoted as scores, not percentages",
  no_em_dash: "No em dashes",
  under_150_words: "Short enough to read in a minute",
};

// Links in the body become clickable; everything else stays as written.
function Body({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/\S+[^\s.,)])/g).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part} style={{ color: "var(--cyan)" }}>{part}</a> : part))}</>;
}

export default async function Touch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [t] = (await sql()`
    select t.*, c.id contact_id, c.name contact_name, c.role contact_role, ac.id account_id, e.name account_name
    from touches t join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    where t.id = ${id}`) as Row[];
  if (!t) notFound();
  const checks = Object.entries(t.detail.checks ?? {});
  const dry = t.status === "dry_run" || t.status === "draft";

  return (
    <main className="wrap">
      <nav className="nav"><Logo /><span className="crumb">MESSAGE · step {t.step} · {t.channel}</span></nav>

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 16, marginTop: 8 }}>
        <article className="panel fade-up" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--line)", display: "grid", gap: 6, fontSize: 13.5, fontFamily: "var(--mono)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <AgentChip agent="writer" label="Written by Writer" />
              <span className="band" style={{ background: dry ? "#ffb31f22" : "#2fd39a22", color: dry ? "#ffb31f" : "#2fd39a", border: `1px solid ${dry ? "#ffb31f88" : "#2fd39a88"}` }}>
                {dry ? "DRY RUN · NOT SENT" : t.status.toUpperCase()}
              </span>
            </div>
            <span><span style={{ color: "var(--mute)" }}>to </span>{t.channel === "letter" ? `letter to ${t.account_name} HQ` : maskEmail(t.to_address)}</span>
            {t.detail.attention && <span><span style={{ color: "var(--mute)" }}>attn </span>{t.detail.attention}, {t.contact_role}</span>}
            <span><span style={{ color: "var(--mute)" }}>subj </span><strong style={{ fontFamily: "var(--display)", fontSize: 16 }}>{t.subject}</strong></span>
          </div>
          <div style={{ padding: "22px 24px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 15.5, lineHeight: 1.65 }}><Body text={t.body} /></div>
        </article>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="panel fade-up" style={{ padding: 24, animationDelay: "80ms" }}>
            <p className="eyebrow">Hard rules, checked in code</p>
            <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
              {checks.map(([k, ok]) => (
                <span key={k}><span style={{ color: ok ? "#2fd39a" : "#ff8080", fontFamily: "var(--mono)" }}>{ok ? "✓" : "✗"}</span> {CHECK_LABEL[k] ?? k}</span>
              ))}
            </div>
            <p style={{ color: "var(--mute)", fontSize: 12.5, margin: "14px 0 0" }}>A draft that fails any rule is rewritten once, then discarded.</p>
          </div>
          <div className="panel fade-up" style={{ padding: 24, animationDelay: "140ms", display: "grid", gap: 8, fontSize: 14 }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Trail</p>
            <a href={`/account/${t.account_id}`}>Account: {t.account_name} →</a>
            <a href={`/contact/${t.contact_id}`}>Contact: {t.contact_name ?? t.contact_role} →</a>
            {t.plan_id && <a href={`/plan/${t.plan_id}`}>Plan and timing →</a>}
            <span style={{ color: "var(--dim)", fontSize: 13 }}>Drafted {new Date(t.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
          </div>
          {dry && (
            <p style={{ color: "var(--mute)", fontSize: 12.5, margin: 0 }}>
              Held until the sending mailbox exists. When it does, the Sequencer adds an opt-out link and a postal address,
              checks the do-not-contact list, and respects quiet hours and daily caps.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
