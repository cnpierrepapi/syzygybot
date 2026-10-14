import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { FocusStars } from "../../components/Sky";
import { setHandoffStatus, STATUS, type Packet } from "@/lib/handoff";
import { Logo, AgentChip } from "../../components/visuals";

// The private page a person gets when a reply turns interested. Whoever holds the link can mark what
// happened next; that goes back on the floor so the trail doesn't stop at "handed off".
export const metadata: Metadata = { title: "Handoff", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Row = { token: string; status: keyof typeof STATUS; packet: Packet; simulated: boolean; created_at: string; updated_at: string; entity_id: string; ws_token: string | null };

async function load(token: string) {
  if (!/^[A-Za-z0-9]{12,40}$/.test(token)) return null;
  const [h] = (await sql()`
    select h.token, h.status, h.packet, h.simulated, h.created_at, h.updated_at, ac.entity_id, w.connect_token ws_token
    from handoffs h join replies r on r.id = h.reply_id join touches t on t.id = r.touch_id join contacts c on c.id = t.contact_id
    join accounts ac on ac.id = c.account_id left join workspaces w on w.id = h.workspace_id where h.token = ${token}`) as Row[];
  return h ?? null;
}

async function mark(formData: FormData) {
  "use server";
  const token = String(formData.get("token")), status = String(formData.get("status"));
  if (!(await load(token)) || !["referred", "closed", "open"].includes(status)) return;
  await setHandoffStatus(token, status as "referred" | "closed" | "open");
  revalidatePath(`/handoff/${token}`);
}

export default async function Handoff({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await load(token);
  if (!h) notFound();
  const p = h.packet, forBrand = !!p.for_brand;

  return (
    <main className="wrap">
      <FocusStars stars={[h.entity_id]} />
      <nav className="nav"><Logo /><span className="crumb">Private · handoff · {p.company}</span></nav>
      {h.simulated && (
        <p className="band" style={{ display: "inline-block", background: "#ffb31f22", color: "#ffb31f", border: "1px solid #ffb31f88", marginTop: 8 }}>
          SIMULATED REPLY · a test of the Inbox agent, not a real person at {p.company}
        </p>
      )}
      <section className="fade-up clear-hero">
        <div style={{ display: "flex" }}><AgentChip agent="inbox" label="Handed over by Inbox" /></div>
        <h1 style={{ fontSize: "clamp(30px, 4.6vw, 52px)", lineHeight: 1.05, marginTop: 18 }}>{p.who} wants to talk.</h1>
        <p style={{ color: "var(--dim)", fontSize: 16.5, maxWidth: 640, marginTop: 12 }}>
          {p.role} at {p.company}{forBrand ? `, replying to a message SYZYGY wrote for ${p.for_brand}` : ""}. {p.summary}
        </p>
        <p style={{ fontSize: 16, maxWidth: 640, margin: "14px 0 0" }}><span className="eyebrow">Do this first</span><br />{p.next_step}</p>
      </section>

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16 }}>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          {p.intro_note && (
            <article className="panel fade-up" style={{ padding: 24 }}>
              <p className="eyebrow">Intro to forward to Qloo</p>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.65 }}>{p.intro_note}</div>
            </article>
          )}
          {p.questions.length > 0 && (
            <article className="panel fade-up" style={{ padding: 24, animationDelay: "60ms" }}>
              <p className="eyebrow">What they asked</p>
              <div style={{ display: "grid", gap: 6 }}>{p.questions.map((x, i) => <span key={i}>{x}</span>)}</div>
            </article>
          )}
          {p.answer && (
            <article className="panel fade-up" style={{ padding: 24, animationDelay: "90ms" }}>
              <p className="eyebrow">What the Inbox agent answered (dry run, not sent)</p>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.65, color: "var(--dim)" }}>{p.answer}</div>
            </article>
          )}
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="panel fade-up" style={{ padding: 24 }}>
            <p className="eyebrow">Where it stands</p>
            <strong style={{ fontSize: 18 }}>{forBrand && h.status === "referred" ? "Taken" : STATUS[h.status]}</strong>
            <span style={{ display: "block", color: "var(--mute)", fontSize: 12.5, marginTop: 4 }}>Since {new Date(h.updated_at).toISOString().slice(0, 10)}</span>
            <form action={mark} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <input type="hidden" name="token" value={h.token} />
              {h.status !== "referred" && <button className="btn" name="status" value="referred" type="submit">{forBrand ? "I've taken it" : "Referred to Qloo"}</button>}
              {h.status !== "closed" && <button className="btn quiet" name="status" value="closed" type="submit">Close it</button>}
              {h.status !== "open" && <button className="btn quiet" name="status" value="open" type="submit">Reopen</button>}
            </form>
          </div>
          {p.numbers.length > 0 && (
            <div className="panel fade-up" style={{ padding: 24, animationDelay: "60ms", display: "grid", gap: 8 }}>
              <p className="eyebrow" style={{ marginBottom: 2 }}>The numbers that started it</p>
              {p.numbers.map(n => (
                <span key={n.label} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ color: "var(--dim)", fontSize: 14 }}>{n.label}</span><strong style={{ fontFamily: "var(--mono)" }}>{n.value.toFixed(2)}</strong>
                </span>
              ))}
              {p.angle && <span style={{ color: "var(--dim)", fontSize: 13.5, marginTop: 6 }}>{p.angle}</span>}
            </div>
          )}
          <div className="panel fade-up" style={{ padding: 24, animationDelay: "100ms", display: "grid", gap: 8, fontSize: 14 }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Trail</p>
            <a href={p.reply_url}>The reply and the agent&apos;s answer →</a>
            <a href={p.account_url}>Everything about {p.company} →</a>
            {h.ws_token && <a href={`/connect/${h.ws_token}`}>Back to your workspace →</a>}
          </div>
        </div>
      </section>
    </main>
  );
}
