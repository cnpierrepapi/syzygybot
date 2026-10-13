// Share cards (1200×630) for X and link previews, drawn with next/og.
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

const Orb = ({ a, b, size }: { a: string; b: string; size: number }) => (
  <div style={{ width: size, height: size, borderRadius: size, background: `radial-gradient(circle at 35% 30%, #ffffff 0%, ${a} 30%, ${b} 100%)`, boxShadow: `0 0 80px ${a}` }} />
);

export function card(opts: { eyebrow: string; title: string; sub?: string; badge?: string; colors?: [string, string, string, string] }) {
  const [a1, a2, b1, b2] = opts.colors ?? ["#ff3d9a", "#ff8a3d", "#3de0ff", "#9b7bff"];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64,
        background: "linear-gradient(135deg, #0b0820 0%, #161140 60%, #241a5c 100%)", color: "#efeaff", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {["#ff3d9a", "#ffd23d", "#3de0ff"].map(c => <div key={c} style={{ width: 18, height: 18, borderRadius: 18, background: c }} />)}
          </div>
          <div style={{ fontSize: 28, letterSpacing: 8, fontWeight: 700 }}>SYZYGY</div>
          <div style={{ fontSize: 22, color: "#9b93c9", marginLeft: 16 }}>{opts.eyebrow}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Orb a={a1} b={a2} size={110} />
            <div style={{ width: 40, height: 3, background: "#ffd23d" }} />
            <Orb a={b1} b={b2} size={110} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ fontSize: opts.title.length > 34 ? 56 : 68, fontWeight: 700, lineHeight: 1.05 }}>{opts.title}</div>
            {opts.sub && <div style={{ fontSize: 28, color: "#c9c2ee", marginTop: 18, lineHeight: 1.3 }}>{opts.sub}</div>}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, color: "#9b93c9" }}>
          <div style={{ display: "flex" }}>Built on Qloo taste data · by Onenept Studios</div>
          {opts.badge && <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, border: "2px solid #ffd23d", color: "#ffd23d", fontWeight: 700, fontSize: 28 }}>{opts.badge}</div>}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
