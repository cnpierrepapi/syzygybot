// Claim flow. A brand claims its page by posting a one-time code from its own X account and pasting the
// post's link. X's public oEmbed endpoint says who really wrote the post (it resolves the author from the
// post id, so a link with someone else's name in it still comes back as the real author). The author has
// to be the handle on file for that brand, and the post has to carry the code.
// The code is public (it's in the post); the claim also needs a secret kept in the claimant's cookie, so
// someone who spots the post can't finish the claim before the brand does.
// A claim makes the brand's private workspace, or takes over one made by hand (new private link).
// Once a brand has claimed, SYZYGY stops pitching the companies that need it in its own voice.

import { timingSafeEqual } from "node:crypto";
import { sql } from "./db";
import { logAction } from "./actions";
import { slugify, token, SITE } from "./slug";

export type Claimable = { qloo_id: string; name: string; type: string; x_handle: string | null; x_handle_status: string; slug: string };
export type Workspace = {
  id: string; entity_id: string; name: string; connect_token: string; claimed_at: string | null; demo: boolean; send_as: boolean;
  signer: string | null; handoff_email: string | null; claim: { handle?: string; handle_status?: string; tweet_url?: string; needs_review?: boolean; demo?: boolean };
  detail: { demo_drafts?: DemoDraft[] };
};
export type DemoDraft = { contact_id: string; who: string; company: string; subject: string; body: string; checks: Record<string, boolean>; at: string };

/** The brand everybody can try a demo claim as. Judges can't post from a real brand's X account. */
export const DEMO_BRAND = process.env.DEMO_CLAIM_BRAND || "Bad Bunny";
const DEMO_PER_DAY = 40;
const CLAIM_HOURS = 24;

const norm = (h: string) => h.replace(/^@/, "").trim().toLowerCase();

/** Brands with at least one company that needs them (the only ones with anything to claim), by readable slug. */
export async function claimables(): Promise<Claimable[]> {
  const rows = (await sql()`
    select distinct e.qloo_id, e.name, e.type, e.x_handle, e.x_handle_status from entities e
    join accounts ac on ac.passed_on = e.qloo_id join pairs p on p.id = ac.pair_id
    where p.deal_status in ('clear','past')`) as Omit<Claimable, "slug">[];
  return rows.map(r => ({ ...r, slug: slugify(r.name) }));
}
export async function claimableBySlug(slug: string) {
  return (await claimables()).find(c => c.slug === slug) ?? null;
}
export const claimPath = (name: string) => `/claim/${slugify(name)}`;

export async function workspaceFor(entityId: string) {
  const [w] = (await sql()`
    select w.*, e.name from workspaces w join entities e on e.qloo_id = w.entity_id
    where w.entity_id = ${entityId} and not w.demo`) as Workspace[];
  return w ?? null;
}
export async function workspaceByToken(t: string) {
  if (!/^[A-Za-z0-9]{8,64}$/.test(t)) return null;
  const [w] = (await sql()`select w.*, e.name from workspaces w join entities e on e.qloo_id = w.entity_id where w.connect_token = ${t}`) as Workspace[];
  return w ?? null;
}

/** The text the brand posts. Plain, with the code and a link back to the page being claimed. */
export const postText = (name: string, code: string) => `Claiming ${name}'s page on SYZYGY. Code ${code} ${SITE}${claimPath(name)}`;
export const intentUrl = (name: string, code: string) => `https://x.com/intent/post?text=${encodeURIComponent(postText(name, code))}`;

export async function startClaim(entityId: string) {
  const code = `SYZ-${token(6).toUpperCase()}`, secret = token(24);
  const [c] = (await sql()`insert into claims (entity_id, code, secret) values (${entityId}, ${code}, ${secret}) returning id`) as { id: string }[];
  return { id: c.id, code, secret };
}

/** Accepts x.com and twitter.com post links, returns the post id. */
export function postId(url: string) {
  const m = url.trim().match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,25})/);
  return m ? m[1] : null;
}

const decode = (s: string) => s.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, "-").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** Who wrote a post and what it says, straight from X. */
export async function readPost(id: string) {
  const res = await fetch(`https://publish.x.com/oembed?url=${encodeURIComponent(`https://x.com/i/status/${id}`)}&omit_script=1&dnt=1`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`X answered ${res.status}`);
  const j = (await res.json()) as { author_url?: string; html?: string };
  const handle = j.author_url?.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/)?.[1] ?? null;
  const text = decode(j.html?.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
  return { handle, text };
}

/** Pure decision, so it can be tested offline. */
export function judgeClaim(onFile: string | null, code: string, post: { handle: string | null; text: string } | null) {
  if (!onFile) return { ok: false, why: "We don't have an X account on file for this brand, so there's nothing to check the post against." };
  if (!post) return { ok: false, why: "X can't find that post. It might be deleted, or the account might be protected." };
  if (!post.handle || norm(post.handle) !== norm(onFile)) return { ok: false, why: `That post is from @${post.handle ?? "someone else"}. It needs to come from @${onFile}.` };
  if (!post.text.toUpperCase().includes(code.toUpperCase())) return { ok: false, why: `The post is from the right account, but the code ${code} isn't in it.` };
  return { ok: true, why: "" };
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function verifyClaim(claimId: string, secret: string, url: string, read = readPost) {
  const [c] = (await sql()`
    select c.*, e.name, e.x_handle, e.x_handle_status from claims c join entities e on e.qloo_id = c.entity_id
    where c.id = ${claimId} and c.status = 'pending' and c.created_at > now() - make_interval(hours => ${CLAIM_HOURS})`) as
    { id: string; entity_id: string; code: string; secret: string; name: string; x_handle: string | null; x_handle_status: string }[];
  if (!c || !same(c.secret, secret)) return { ok: false as const, why: "This claim has run out or was started in another browser. Start again." };
  const id = postId(url);
  if (!id) return { ok: false as const, why: "That doesn't look like a link to a post on X." };
  let post: Awaited<ReturnType<typeof readPost>>;
  try { post = await read(id); } catch (e) { return { ok: false as const, why: `Couldn't reach X just now (${(e as Error).message}). Try again in a minute.` }; }
  const verdict = judgeClaim(c.x_handle, c.code, post);
  await sql()`update claims set tweet_url = ${url}, detail = ${JSON.stringify({ post, verdict })} where id = ${c.id}`;
  if (!verdict.ok) return { ok: false as const, why: verdict.why };

  // A handle only one source vouched for could belong to the wrong account: the claim stands, but sending
  // in the brand's name waits until a person has looked.
  const claim = { handle: c.x_handle, handle_status: c.x_handle_status, tweet_url: url, needs_review: c.x_handle_status !== "verified" };
  const fresh = token(24);
  const [w] = (await sql()`
    insert into workspaces (entity_id, name, connect_token, claimed_at, claim) values (${c.entity_id}, ${c.name}, ${fresh}, now(), ${JSON.stringify(claim)})
    on conflict (entity_id) where not demo do update set connect_token = ${fresh}, claimed_at = now(), claim = ${JSON.stringify(claim)}
    returning id`) as { id: string }[];
  await sql()`update claims set status = 'verified', verified_at = now() where id = ${c.id}`;
  const stopped = await stopPitchesAbout(c.entity_id, c.name);
  await logAction({
    agent: "verifier", kind: "claim.verified",
    summary: `${c.name} claimed its page: @${c.x_handle} posted the code. SYZYGY stops pitching the companies that need ${c.name}${stopped ? ` (${stopped} unsent message${stopped === 1 ? "" : "s"} called off)` : ""}.`,
    detail: { entity_id: c.entity_id, workspace_id: w.id },
  });
  return { ok: true as const, token: fresh };
}

/** SYZYGY's own unsent pitches to the companies that need this brand are called off. */
export async function stopPitchesAbout(entityId: string, name: string) {
  const rows = (await sql()`
    update touches t set status = 'cancelled', detail = t.detail || ${JSON.stringify({ cancelled: `${name} claimed its page` })}::jsonb
    from contacts c join accounts ac on ac.id = c.account_id
    where c.id = t.contact_id and ac.passed_on = ${entityId} and t.workspace_id is null and t.status in ('draft','dry_run','queued')
    returning t.id`) as { id: string }[];
  return rows.length;
}

/** Real claimed brands (not demos), keyed by entity: the agents check this before pitching. */
export async function claimedEntities() {
  const rows = (await sql()`select w.*, e.name from workspaces w join entities e on e.qloo_id = w.entity_id where w.claimed_at is not null and not w.demo`) as Workspace[];
  return new Map(rows.map(w => [w.entity_id, w]));
}

/** A demo claim for judges: a throwaway workspace for the demo brand. It never sends and never stops anything. */
export async function demoClaim() {
  const [e] = (await sql()`select qloo_id, name from entities where lower(name) = lower(${DEMO_BRAND}) limit 1`) as { qloo_id: string; name: string }[];
  if (!e) return { ok: false as const, why: "The demo brand isn't in the data yet." };
  const [{ n }] = (await sql()`select count(*)::int n from workspaces where demo and created_at > now() - interval '1 day'`) as { n: number }[];
  if (n >= DEMO_PER_DAY) return { ok: false as const, why: "Too many demo claims today. Try again tomorrow." };
  const t = token(24);
  await sql()`insert into workspaces (entity_id, name, connect_token, claimed_at, demo, claim) values (${e.qloo_id}, ${e.name}, ${t}, now(), true, ${JSON.stringify({ demo: true })})`;
  return { ok: true as const, token: t };
}
