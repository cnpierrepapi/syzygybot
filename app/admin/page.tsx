import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin, signIn } from "@/lib/admin";
import { Logo } from "../components/visuals";

// The operator's sign-in: unlocks "Approve and send" on message pages. Kept out of search results.
export const metadata: Metadata = { title: "Operator", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const safeNext = (n: string | undefined) => (n && /^\/[a-z0-9/_-]*$/i.test(n) ? n : "/");

export default async function Admin({ searchParams }: { searchParams: Promise<{ next?: string; bad?: string }> }) {
  const { next, bad } = await searchParams;
  const to = safeNext(next);
  if (await isAdmin()) redirect(to);
  return (
    <main className="wrap">
      <nav className="nav"><Logo /><span className="crumb">OPERATOR</span></nav>
      <section className="panel fade-up" style={{ padding: 32, maxWidth: 520, marginTop: 8 }}>
        <form action={async (fd: FormData) => {
          "use server";
          const ok = await signIn(String(fd.get("key") ?? ""));
          redirect(ok ? to : `/admin?bad=1&next=${encodeURIComponent(to)}`);
        }} style={{ display: "grid", gap: 14 }}>
          <h1 style={{ fontFamily: "var(--display)", fontSize: 26, margin: 0 }}>Operator sign-in</h1>
          <p style={{ color: "var(--mute)", margin: 0, fontSize: 14 }}>For the person who approves real sends. Everyone else can read every page without it.</p>
          <input name="key" type="password" autoComplete="current-password" aria-label="Operator key"
            style={{ padding: "10px 12px", background: "transparent", color: "inherit", border: "1px solid var(--line)", borderRadius: 8, fontFamily: "var(--mono)" }} />
          {bad && <span style={{ color: "#ff8080", fontSize: 13 }}>That key didn't match.</span>}
          <button type="submit" className="band" style={{ cursor: "pointer", padding: "10px 18px", fontSize: 14, justifySelf: "start" }}>Sign in</button>
        </form>
      </section>
    </main>
  );
}
