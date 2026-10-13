import { typeColors, AGENTS, agentColor } from "@/lib/ui";

let uid = 0;
const nextId = (p: string) => `${p}${++uid}`;

/** Two stars joined by a thesis line, in the same drawing language as the sky. */
export function Alignment({ a, b, aType, bType, height = 150 }: { a: string; b: string; aType: string; bType: string; height?: number }) {
  const [a1] = typeColors(aType), [b1] = typeColors(bType);
  const gl = nextId("gl"), blur = nextId("bl");
  return (
    <svg viewBox="0 0 600 100" width="100%" height={height} role="img" aria-label={`${a} aligned with ${b}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gl} x1="0" x2="1"><stop offset="0%" stopColor={a1} /><stop offset="50%" stopColor="#ffb020" /><stop offset="100%" stopColor={b1} /></linearGradient>
        <filter id={blur} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="9" /></filter>
      </defs>
      <path d="M60 60 Q300 18 540 60" fill="none" stroke={`url(#${gl})`} strokeWidth="1.5" strokeOpacity="0.85" />
      <circle cx="300" cy="39" r="3" fill="#ffb020" />
      <circle cx="60" cy="60" r="22" fill={a1} opacity="0.45" filter={`url(#${blur})`} />
      <circle cx="540" cy="60" r="22" fill={b1} opacity="0.45" filter={`url(#${blur})`} />
      <circle cx="60" cy="60" r="7" fill={a1} /><circle cx="60" cy="60" r="3" fill="#fff" />
      <circle cx="540" cy="60" r="7" fill={b1} /><circle cx="540" cy="60" r="3" fill="#fff" />
    </svg>
  );
}

/** Hero number for a 0..1 score: amber for PITCH, blue for WATCH, grey below the bar. */
export function ScoreRing({ score, band, size = 168 }: { score: number; band: string; size?: number }) {
  const r = 66, c = 2 * Math.PI * r;
  const color = band === "PITCH" ? "#ffb020" : band === "WATCH" ? "#7b8ff0" : "#5f6884";
  return (
    <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={`Score ${score.toFixed(2)}, ${band}`}>
      <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(148,163,210,0.14)" strokeWidth="6" />
      <circle cx="80" cy="80" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${c * Math.max(0, Math.min(1, score))} ${c}`} transform="rotate(-90 80 80)" style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
      <text x="80" y="84" textAnchor="middle" fill="#e8ebf4" fontSize="36" fontWeight="700" fontFamily="var(--display)">{score.toFixed(2)}</text>
      <text x="80" y="106" textAnchor="middle" fill={color} fontSize="10.5" letterSpacing="3" fontFamily="var(--mono)">{band}</text>
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
