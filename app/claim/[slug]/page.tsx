import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { FocusStars } from "../../components/Sky";
import { claimableBySlug, startClaim, verifyClaim, demoClaim, postText, intentUrl, workspaceFor, DEMO_BRAND } from "@/lib/claim";
import { pathFor, slugify } from "@/lib/slug";
import { Logo } from "../../components/visuals";

// A brand claims its page by posting a code from its own X account. Public, but kept out of search:
// it's a form, not something to land on from Google.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COOKIE = "syz_claim", FLASH = "syz_claim_flash";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await claimableBySlug((await params).slug);
  return { title: c ? `Claim ${c.name}'s page` : "Claim a page", robots: { index: false, follow: true } };
}

async function flash(why: string) {
  (await cookies()).set(FLASH, why.slice(0, 300), { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60, path: "/claim" });
}

async function start(formData: FormData) {
  "use server";
  const c = await claimableBySlug(String(formData.get("slug")));
  if (!c?.x_handle) return;
  const s = await startClaim(c.qloo_id);
  (await cookies()).set(COOKIE, `${s.id}.${s.secret}`, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 24 * 3600, path: "/claim" });
  redirect(`/claim/${c.slug}#post`);
}

async function check(formData: FormData) {
  "use server";
  const slug = String(formData.get("slug"));
  const [id, secret] = ((await cookies()).get(COOKIE)?.value ?? "").split(".");
  if (!id || !secret) { await flash("Start with a code first."); redirect(`/claim/${slug}`); }
  const r = await verifyClaim(id, secret, String(formData.get("url") ?? "").slice(0, 300));
  if (!r.ok) { await flash(r.why); redirect(`/claim/${slug}#post`); }
  (await cookies()).delete({ name: COOKIE, path: "/claim" });
  redirect(`/connect/${r.token}?claimed=1`);
}

async function demo() {
  "use server";
  const r = await demoClaim();
  if (!r.ok) { await flash(r.why); redirect(`/claim/${slugify(DEMO_BRAND)}`); }
  redirect(`/connect/${r.token}?demo=1`);
}

export default async function Claim({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await claimableBySlug(slug);
  if (!c) notFound();
  const jar = await cookies();
  const why = jar.get(FLASH)?.value;
  // The claim in progress, if this browser started one for this brand.
  const [id] = (jar.get(COOKIE)?.value ?? "").split(".");
  const [pending] = id && /^[0-9a-f-]{36}$/.test(id)
    ? (await sql()`select code from claims where id = ${id} and entity_id = ${c.qloo_id} and status = 'pending' and created_at > now() - interval '24 hours'`) as { code: string }[]
    : [];
  const targets = (await sql()`
    select ac.id, ac.slug, e.name, p.score, p.band, ac.evidence->'pull'->>'accountFansLikePartner' lean
    from accounts ac join entities e on e.qloo_id = ac.entity_id join pairs p on p.id = ac.pair_id
    where ac.passed_on = ${c.qloo_id} and p.deal_status in ('clear','past') order by p.score desc`) as { id: string; slug: string | null; name: string; score: number; band: string; lean: string | null }[];
  const ws = await workspaceFor(c.qloo_id);
  const isDemoBrand = c.name.toLowerCase() === DEMO_BRAND.toLowerCase();

  return (
    <main className="wrap">
      <FocusStars stars={[c.qloo_id]} />
      <nav className="nav"><Logo /><span className="crumb">CLAIM · {c.name}</span></nav>

      <section className="fade-up clear-hero">
        <p className="eyebrow">Is this you, {c.name}?</p>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", lineHeight: 1.04 }}>
          {targets.length} {targets.length === 1 ? "company needs" : "companies need"} {c.name}.
        </h1>
        <p style={{ color: "var(--dim)", fontSize: 16.5, maxWidth: 640, marginTop: 14 }}>
          Their fans lean toward you harder than yours lean back. Claim this page and you get the people to talk to at each one,
          the angle, and a first message. SYZYGY stops pitching them about you. And if you want, it writes to them for you, signed as you.
        </p>
      </section>

      <section className="split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 16, marginTop: 16 }}>
        <div className="panel fade-up" style={{ padding: 26 }} id="post">
          {ws?.claimed_at && (
            <p style={{ margin: "0 0 16px", color: "#9ff5cf", fontSize: 14 }}>
              Already claimed. Lost the link? Claim it again and you get a fresh one. The old one stops working.
            </p>
          )}
          {!c.x_handle ? (
            <>
              <p className="eyebrow">Claiming</p>
              <p style={{ margin: 0 }}>
                We don&apos;t have an X account on file for {c.name} that we can check a post against, so this page can&apos;t be claimed yet.
              </p>
            </>
          ) : (
            <div className="steps">
              <div>
                <span>
                  <strong>Get a code.</strong>
                  <span style={{ display: "block", color: "var(--dim)", fontSize: 14, margin: "4px 0 10px" }}>It lasts 24 hours and only works in this browser.</span>
                  <form action={start}>
                    <input type="hidden" name="slug" value={c.slug} />
                    <button className={pending ? "btn quiet" : "btn"} type="submit">{pending ? "Get a new code" : "Get my code"}</button>
                  </form>
                </span>
              </div>
              <div style={{ opacity: pending ? 1 : 0.45 }}>
                <span>
                  <strong>Post it from @{c.x_handle}.</strong>
                  <span style={{ display: "block", color: "var(--dim)", fontSize: 14, margin: "4px 0 10px" }}>
                    Any post works as long as it comes from @{c.x_handle} and has the code in it. Delete it once you&apos;re in, if you like.
                  </span>
                  {pending && (
                    <>
                      <div className="post-text">{postText(c.name, pending.code)}</div>
                      <a className="btn" style={{ marginTop: 10 }} href={intentUrl(c.name, pending.code)} target="_blank" rel="noopener">Post it on X →</a>
                    </>
                  )}
                </span>
              </div>
              <div style={{ opacity: pending ? 1 : 0.45 }}>
                <span>
                  <strong>Paste the link to your post.</strong>
                  <form action={check} style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    <input type="hidden" name="slug" value={c.slug} />
                    <label className="field">
                      <span>Link to the post</span>
                      <input name="url" type="url" required placeholder={`https://x.com/${c.x_handle}/status/…`} disabled={!pending} />
                    </label>
                    <span><button className="btn" type="submit" disabled={!pending}>Check it</button></span>
                  </form>
                  {why && <p style={{ color: "#ffb3aa", fontSize: 14, margin: "10px 0 0" }}>{why}</p>}
                </span>
              </div>
            </div>
          )}
          {c.x_handle && c.x_handle_status !== "verified" && (
            <p style={{ color: "var(--mute)", fontSize: 12.5, margin: "18px 0 0" }}>
              Only one source says @{c.x_handle} is {c.name}&apos;s account. You can still claim, but sending in your name waits until a person has had a look.
            </p>
          )}
        </div>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="panel fade-up" style={{ padding: 24, animationDelay: "80ms" }}>
            <p className="eyebrow">Who needs you</p>
            <div style={{ display: "grid" }}>
              {targets.map(t => (
                <a key={t.id} href={pathFor("accounts", t.slug, t.id)} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
                  <span>{t.name}{t.lean && <span style={{ color: "var(--mute)", fontSize: 13 }}> · their fans → you {Number(t.lean).toFixed(2)}</span>}</span>
                  <span className={`band band-${t.band}`}>{Number(t.score).toFixed(2)}</span>
                </a>
              ))}
            </div>
            <p style={{ color: "var(--mute)", fontSize: 12.5, margin: "12px 0 0" }}>Affinity is a Qloo score from 0 to 1.</p>
          </div>
          <div className="panel fade-up" style={{ padding: 24, animationDelay: "120ms" }}>
            <p className="eyebrow">Just looking?</p>
            <p style={{ margin: "0 0 12px", fontSize: 14.5 }}>
              Try a demo claim as {DEMO_BRAND}. You get the same workspace a brand gets. Nothing gets sent and nothing real changes.
            </p>
            <form action={demo}><button className="btn quiet" type="submit">Try the demo{isDemoBrand ? "" : ` as ${DEMO_BRAND}`}</button></form>
          </div>
        </div>
      </section>
    </main>
  );
}
