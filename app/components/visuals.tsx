import { typeColors, AGENTS, agentColor } from "@/lib/ui";

let uid = 0;
const nextId = (p: string) => `${p}${++uid}`;

/** Two bodies in syzygy: a planet per entity, joined by an animated alignment line. */
export function Alignment({ a, b, aType, bType, height = 150 }: { a: string; b: string; aType: string; bType: string; height?: number }) {
  const [a1, a2] = typeColors(aType), [b1, b2] = typeColors(bType);
  const ga = nextId("ga"), gb = nextId("gb"), gl = nextId("gl"), blur = nextId("bl");
  return (
    <svg viewBox="0 0 600 150" width="100%" height={height} role="img" aria-label={`${a} aligned with ${b}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <radialGradient id={ga} cx="35%" cy="35%"><stop offset="0%" stopColor="#fff" stopOpacity="0.9" /><stop offset="25%" stopColor={a1} /><stop offset="100%" stopColor={a2} /></radialGradient>
        <radialGradient id={gb} cx="35%" cy="35%"><stop offset="0%" stopColor="#fff" stopOpacity="0.9" /><stop offset="25%" stopColor={b1} /><stop offset="100%" stopColor={b2} /></radialGradient>
        <linearGradient id={gl} x1="0" x2="1"><stop offset="0%" stopColor={a1} /><stop offset="50%" stopColor="#ffd23d" /><stop offset="100%" stopColor={b1} /></linearGradient>
        <filter id={blur} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14" /></filter>
      </defs>
      <line x1="80" y1="75" x2="520" y2="75" stroke={`url(#${gl})`} strokeWidth="2" className="glow-line" />
      <circle cx="300" cy="75" r="9" fill="#ffd23d" opacity="0.9" />
      <circle cx="300" cy="75" r="22" fill="#ffd23d" opacity="0.25" filter={`url(#${blur})`} />
      <circle cx="80" cy="75" r="56" fill={a1} opacity="0.35" filter={`url(#${blur})`} />
      <circle cx="520" cy="75" r="56" fill={b1} opacity="0.35" filter={`url(#${blur})`} />
      <ellipse cx="80" cy="75" rx="70" ry="16" fill="none" stroke={a1} strokeOpacity="0.5" className="orbit-spin" />
      <circle cx="80" cy="75" r="44" fill={`url(#${ga})`} />
      <ellipse cx="520" cy="75" rx="70" ry="16" fill="none" stroke={b1} strokeOpacity="0.5" className="orbit-spin" />
      <circle cx="520" cy="75" r="44" fill={`url(#${gb})`} />
    </svg>
  );
}

/** Hero number for a 0..1 score, with a gradient ring. */
export function ScoreRing({ score, band, size = 168 }: { score: number; band: string; size?: number }) {
  const r = 66, c = 2 * Math.PI * r, g = nextId("sr");
  const stops = band === "PITCH" ? ["#ff3d9a", "#ff8a3d", "#ffd23d"] : band === "WATCH" ? ["#3de0ff", "#9b7bff", "#9b7bff"] : ["#6f6a9c", "#6f6a9c", "#6f6a9c"];
  return (
    <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={`Score ${score.toFixed(2)}, ${band}`}>
      <defs><linearGradient id={g} x1="0" y1="0" x2="1" y2="1">{stops.map((s, i) => <stop key={i} offset={`${i * 50}%`} stopColor={s} />)}</linearGradient></defs>
      <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(160,140,255,0.15)" strokeWidth="10" />
      <circle cx="80" cy="80" r={r} fill="none" stroke={`url(#${g})`} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${c * Math.max(0, Math.min(1, score))} ${c}`} transform="rotate(-90 80 80)" />
      <text x="80" y="82" textAnchor="middle" fill="#efeaff" fontSize="38" fontWeight="700" fontFamily="var(--display)">{score.toFixed(2)}</text>
      <text x="80" y="106" textAnchor="middle" fill="#a49fcf" fontSize="11" letterSpacing="3" fontFamily="var(--mono)">{band}</text>
    </svg>
  );
}

export function Logo() {
  return (
    <a href="/" className="brand" aria-label="SYZYGY home">
      <span className="brand-dots">
        <i style={{ background: "#ff3d9a", boxShadow: "0 0 10px #ff3d9a" }} />
        <i style={{ background: "#ffd23d", boxShadow: "0 0 10px #ffd23d" }} />
        <i style={{ background: "#3de0ff", boxShadow: "0 0 10px #3de0ff" }} />
      </span>
      SYZYGY
    </a>
  );
}

export function AgentChip({ agent, label }: { agent: string; label?: string }) {
  const c = agentColor(agent);
  return <span className="chip" style={{ borderColor: `${c}66`, color: "#efeaff" }}><i style={{ background: c, boxShadow: `0 0 8px ${c}` }} />{label ?? agent.replace("_", " ")}</span>;
}

export function AgentLegend() {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{AGENTS.map(a => <AgentChip key={a} agent={a} />)}</div>;
}
