import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { sql } from "@/lib/db";
import { FocusStars } from "../../components/Sky";
import { resolve, pathFor } from "@/lib/slug";
import { maskEmail } from "@/lib/ui";
import { showSimulated } from "@/lib/floor";
import { Logo, AgentChip } from "../../components/visuals";

// About a person, or a working document: visible on the floor, kept out of search results.
export const metadata: Metadata = { title: "Message", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

type Row = {
  id: string; channel: string; step: number; subject: string | null; body: string; status: string; to_address: string | null;
  created_at: string; scheduled_for: string | null;
  detail: { checks?: Record<string, boolean>; attention?: string | null; tz?: string; footer?: string; cancelled?: string; signed_as?: string };
  workspace_id: string | null;
  contact_id: string; contact_name: string | null; contact_role: string; plan_id: string | null; account_id: string; account_name: string;
  slug: string | null; contact_slug: string | null; account_slug: string | null; plan_slug: string | null; optout_token: string | null; entity_id: string;
};

const CHECK_LABEL: Record<string, string> = {
  discloses_ai: "Says it is an AI agent in the opening lines",
  credits_qloo_data: "Credits Qloo's taste data",
  not_posing_as_qloo: "Never claims to be Qloo",
  no_percentages: "Affinity scores quoted as scores, not percentages",
  no_em_dash: "No em dashes",
  under_150_words: "Short enough to read in a minute",
  names_brand: "Says up front which brand it writes for",
};

// Links in the body become clickable; everything else stays as written.
function Body({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/\S+[^\s.,)])/g).map((part, i) => (/^https?:\/\//.test(part) ? <a key={i} href={part} style={{ color: "var(--cyan)" }}>{part}</a> : part))}</>;
}

export default async function Message({ params }: { params: Promise<{ id: string }> }) {
  const { id: key } = await params;
  const hit = await resolve("touches", key);
  if (!hit) notFound();
  if (hit.redirect) permanentRedirect(hit.redirect);
  const id = hit.id;
  const [t] = (await sql()`
    select t.*, ac.entity_id, c.id contact_id, c.slug contact_slug, c.name contact_name, c.role contact_role, ac.id account_id, ac.slug account_slug, e.name account_name,
      (select slug from plans where id = t.plan_id) plan_slug
    from touches t join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    where t.id = ${id}`) as Row[];
  if (!t) notFound();
  const steps = (await sql()`
    select id, slug, step, status, scheduled_for, detail->>'cancelled' cancelled from touches
    where contact_id = ${t.contact_id} and plan_id is not distinct from ${t.plan_id} order by step, created_at`) as { id: string; slug: string | null; step: number; status: string; scheduled_for: string | null; cancelled: string | null }[];
  const replies = (await sql()`
    select r.id, r.slug, r.class, r.simulated, r.created_at from replies r join touches x on x.id = r.touch_id
    where x.contact_id = ${t.contact_id} and (${showSimulated()} or not r.simulated) order by r.created_at`) as { id: string; slug: string | null; class: string; simulated: boolean; created_at: string }[];
  const tz = t.detail.tz;
  const when = (d: string) => tz
    ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d))
    : new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const checks = Object.entries(t.detail.checks ?? {});
  const dry = t.status === "dry_run" || t.status === "draft";

  return (
    <main className="wrap">
      <h1 className="sr-only">Message to {t.contact_name ?? t.account_name}, step {t.step}</h1>
      <FocusStars stars={[t.entity_id]} />
      <nav className="nav"><Logo /><span className="crumb">MESSAGE · step {t.step} · {t.channel}</span></nav>

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 16, marginTop: 8 }}>
        <article className="panel fade-up" style={{ padding: 0, overflow: "hidden", alignSelf: "start" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--line)", display: "grid", gap: 6, fontSize: 13.5, fontFamily: "var(--mono)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <AgentChip agent={t.step > 1 ? "sequencer" : "writer"} label={t.step > 1 ? "Follow-up by Sequencer" : "Written by Writer"} />
              <span className="band" style={{ background: dry ? "#ffb31f22" : "#2fd39a22", color: dry ? "#ffb31f" : "#2fd39a", border: `1px solid ${dry ? "#ffb31f88" : "#2fd39a88"}` }}>
                {t.status === "cancelled" ? "CANCELLED" : dry ? "DRY RUN · NOT SENT" : t.status.toUpperCase()}
              </span>
            </div>
            <span><span style={{ color: "var(--mute)" }}>to </span>{t.channel === "letter" ? `letter to ${t.account_name} HQ` : maskEmail(t.to_address)}</span>
            {t.detail.attention && <span><span style={{ color: "var(--mute)" }}>attn </span>{t.detail.attention}, {t.contact_role}</span>}
            {!t.workspace_id && <span><span style={{ color: "var(--mute)" }}>subj </span><strong style={{ fontFamily: "var(--display)", fontSize: 16 }}>{t.subject}</strong></span>}
          </div>
          {/* Written for a brand that claimed its page: the words are theirs, so only their workspace shows them. */}
          {t.workspace_id
            ? <div style={{ padding: "22px 24px", fontSize: 15.5, lineHeight: 1.65, color: "var(--dim)" }}>Written for a brand that claimed its page and signed as them. The message is theirs, so it stays on their private workspace.</div>
            : <div style={{ padding: "22px 24px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 15.5, lineHeight: 1.65 }}><Body text={t.body} /></div>}
          {t.detail.footer && (
            <div style={{ padding: "14px 24px 20px", borderTop: "1px dashed var(--line)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12.5, color: "var(--mute)", fontFamily: "var(--mono)" }}>
              <span className="eyebrow" style={{ display: "block", marginBottom: 6 }}>Added by the Sequencer at send time</span>
              {/* The opt-out token is the recipient's alone; on this public page it's masked. */}
              <Body text={t.detail.footer.replace(/\/optout\/[A-Za-z0-9]+/, "/optout/••••••••")} />
            </div>
          )}
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
            <a href={pathFor("accounts", t.account_slug, t.account_id)}>Account: {t.account_name} →</a>
            <a href={pathFor("contacts", t.contact_slug, t.contact_id)}>Contact: {t.contact_name ?? t.contact_role} →</a>
            {t.plan_id && <a href={pathFor("plans", t.plan_slug, t.plan_id)}>Plan and timing →</a>}
            <span style={{ color: "var(--dim)", fontSize: 13 }}>Drafted {new Date(t.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
          </div>
          {steps.length > 0 && (
            <div className="panel fade-up" style={{ padding: 24, animationDelay: "110ms", display: "grid", gap: 10, fontSize: 14 }}>
              <p className="eyebrow" style={{ marginBottom: 2 }}>Sequence{tz ? ` · ${tz}` : ""}</p>
              {steps.map(s => (
                <a key={s.id} href={pathFor("touches", s.slug, s.id)} style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 8, opacity: s.id === t.id ? 1 : 0.8 }}>
                  <span style={{ fontFamily: "var(--mono)", color: s.id === t.id ? "var(--cyan)" : "var(--mute)" }}>step {s.step}</span>
                  <span>
                    {s.status === "cancelled" ? <span style={{ color: "#ff8080" }}>cancelled{s.cancelled ? `: ${s.cancelled}` : ""}</span>
                      : s.scheduled_for ? `${when(s.scheduled_for)}` : <span style={{ color: "var(--mute)" }}>not scheduled yet</span>}
                  </span>
                </a>
              ))}
              <span style={{ color: "var(--dim)", fontSize: 12.5 }}>Tue to Thu, 09:00 to 11:30 in their time zone. Max 20 a day, one per company a day. Stops on any reply or opt-out.</span>
            </div>
          )}
          {replies.length > 0 && (
            <div className="panel fade-up" style={{ padding: 24, animationDelay: "120ms", display: "grid", gap: 8, fontSize: 14 }}>
              <p className="eyebrow" style={{ marginBottom: 2 }}>Replies</p>
              {replies.map(r => (
                <a key={r.id} href={pathFor("replies", r.slug, r.id)}>{r.class.replace("_", " ")}{r.simulated ? " (simulated)" : ""} →</a>
              ))}
            </div>
          )}
          {dry && (
            <p style={{ color: "var(--mute)", fontSize: 12.5, margin: 0 }}>
              Held until the sending mailbox exists. Nothing on this page has been sent.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
