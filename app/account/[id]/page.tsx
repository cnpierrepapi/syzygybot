import { notFound } from "next/navigation";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Partner = { name: string; type: string; pullOut: number; pullBack: number };
type Row = {
  id: string; reason: string; created_at: string; pair_id: string;
  name: string; type: string; x_handle: string | null; x_handle_status: string;
  passed_name: string; passed_type: string;
  evidence: {
    pair?: { score: number; band: string; thesis: string | null };
    pull?: { partnerFansLikeAccount: number | null; accountFansLikePartner: number | null };
    sharedTaste?: string[];
    cities?: { shared: string[]; account: string[] };
    audienceAge?: Record<string, number> | null;
    morePartners?: Partner[];
    source?: string;
  };
};

const AGE_ORDER = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];
const n = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(2));
const H2 = ({ children }: { children: React.ReactNode }) =>
  <h2 style={{ marginTop: 36, fontSize: 14, letterSpacing: "0.2em", color: "var(--dim)" }}>{children}</h2>;

export default async function Account({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [a] = (await sql()`
    select ac.*, e.name, e.type, e.x_handle, e.x_handle_status, p.name passed_name, p.type passed_type
    from accounts ac join entities e on e.qloo_id = ac.entity_id left join entities p on p.qloo_id = ac.passed_on
    where ac.id = ${id}`) as Row[];
  if (!a) notFound();
  const ev = a.evidence;

  return (
    <main style={{ padding: "48px 6vw", maxWidth: 1000 }}>
      <p style={{ margin: 0, letterSpacing: "0.2em" }}><a href="/" style={{ color: "var(--hot)" }}>SYZYGY</a> / ACCOUNT</p>
      <h1 style={{ fontSize: "clamp(28px, 5vw, 56px)", margin: "12px 0 4px", lineHeight: 1.05 }}>{a.name}</h1>
      <p style={{ color: "var(--dim)", margin: 0 }}>
        {a.type}{a.x_handle ? ` · X @${a.x_handle} (${a.x_handle_status})` : ""} · qualified {new Date(a.created_at).toISOString().slice(0, 10)}
        {" · "}<a href={`/thesis/${a.pair_id}`}>from the {a.name} × {a.passed_name} thesis</a>
      </p>

      <H2>WHY THIS SIDE</H2>
      <p style={{ fontSize: 17, lineHeight: 1.5, maxWidth: 760 }}>{a.reason}</p>
      <p style={{ color: "var(--dim)" }}>{a.passed_name} ({a.passed_type}) is evidence only and is never contacted.</p>

      <H2>NUMBERS</H2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <Stat label={`${a.passed_name} fans → ${a.name}`} value={n(ev.pull?.partnerFansLikeAccount)} />
        <Stat label={`${a.name} fans → ${a.passed_name}`} value={n(ev.pull?.accountFansLikePartner)} />
        <Stat label="pair score" value={`${n(ev.pair?.score)} ${ev.pair?.band ?? ""}`} />
      </div>
      {!!ev.sharedTaste?.length && <p><span style={{ color: "var(--dim)" }}>Shared audience taste:</span> {ev.sharedTaste.join(", ")}</p>}
      {ev.cities && (
        <p>
          <span style={{ color: "var(--dim)" }}>Cities where both audiences are strong:</span> {ev.cities.shared.join(", ") || "none in the top cells"}<br />
          <span style={{ color: "var(--dim)" }}>{a.name}&apos;s strongest US cities:</span> {ev.cities.account.join(", ") || "—"}
        </p>
      )}
      {ev.audienceAge && (
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 60px", gap: "4px 12px", maxWidth: 560, marginTop: 12 }}>
          {AGE_ORDER.filter(k => k in ev.audienceAge!).map(k => {
            const v = ev.audienceAge![k];
            return [
              <span key={k + "l"} style={{ color: "var(--dim)" }}>{k.replaceAll("_", " ")}</span>,
              <span key={k + "b"} style={{ position: "relative", height: 12, alignSelf: "center", borderLeft: "1px solid var(--line)" }}>
                <span style={{ position: "absolute", left: v < 0 ? `${50 + v * 50}%` : "50%", width: `${Math.abs(v) * 50}%`, top: 0, bottom: 0, background: v < 0 ? "var(--dim)" : "var(--hot)" }} />
              </span>,
              <span key={k + "v"}>{v > 0 ? "+" : ""}{v.toFixed(2)}</span>,
            ];
          })}
        </div>
      )}

      <H2>THREE MORE PARTNERS QLOO FOUND FOR {a.name.toUpperCase()}</H2>
      <div style={{ borderTop: "1px solid var(--line)" }}>
        {(ev.morePartners ?? []).map(p => (
          <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr 90px 200px", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <span>{p.name}</span><span style={{ color: "var(--dim)" }}>{p.type}</span>
            <span>{n(p.pullOut)} out · {n(p.pullBack)} back</span>
          </div>
        ))}
      </div>
      <p style={{ color: "var(--dim)", marginTop: 32, maxWidth: 760, lineHeight: 1.5 }}>
        {ev.source ?? "Source: Qloo taste data."} Picked by the Qualifier and assembled by the Numbers agent with no human review.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--line)", padding: 16 }}>
      <div style={{ color: "var(--dim)", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 28, marginTop: 6 }}>{value}</div>
    </div>
  );
}
