// Desks for businesses Qloo has no record of (26 Oct). Qloo can't measure a name it doesn't know, so SYZYGY reads the
// business's own site and picks anchors: three to six things Qloo does know (podcasts, brands, shows, people) whose audience
// is the one the business sells to. A run reads the anchors' audience together, and both numbers on every card are Qloo's:
// how the anchors' audience leans toward a candidate, and how the candidate's audience leans back toward the anchors.
// The anchors are the whole read, so they're listed on the desk, and its verified owner can swap one and run it again.
import { sql } from "../db";
import { logAction } from "../actions";
import { ask, parseJson } from "../llm";
import { readPage, fetchable } from "../web";
import { search, type EntityType } from "../qloo";
import { slugify, token } from "../slug";
import { resolve } from "./qx";

export type Anchor = { id: string; name: string; type: EntityType; why: string | null };

const KINDS: EntityType[] = ["podcast", "brand", "tv_show", "person", "artist", "movie"];
const MIN = 2, MAX = 6, PICK = 5, DESKS_PER_DAY = 60;

const norm = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

/** "onenept.com", "www.onenept.com/about" or a full URL -> "https://onenept.com/". Null when it isn't a public site. */
export function siteOf(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/\.[a-z]{2,}$/i.test(u.hostname)) return null;
    const site = `https://${u.hostname.toLowerCase().replace(/^www\./, "")}/`;
    return fetchable(site) ? site : null;
  } catch { return null; }
}

/** Looks like a site rather than a name: "onenept.com", "https://…". */
export const looksLikeSite = (q: string) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(q.trim());

const rootOf = (site: string) => new URL(site).hostname.split(".").slice(/\.(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(new URL(site).hostname) ? -3 : -2).join(".");

type Read = { name: string; about: string; audience: string; anchors: { name: string; type: string; why: string }[] };

/** The business's own pages, read by us, and a model's picks from them. Picks only count once Qloo has the exact name. */
async function read(site: string) {
  const pages = (await Promise.all([site, `${site}about`].map(u => readPage(u)))).filter(p => p && p.status < 400 && p.text.length > 200);
  if (!pages.length) return null;
  const text = pages.map(p => `${p!.title ?? ""}\n${p!.text}`).join("\n\n").slice(0, 9000);
  const r = await ask("write", `You read a company's own website and say who its customers and fans are, in terms a taste-data company
like Qloo would know. Qloo knows popular podcasts, consumer and tech brands, TV shows, public figures and artists, by their exact
public names. Reply with JSON only.`, `Website: ${site}

${text}

Give:
- name: the business's name as it calls itself
- about: one plain sentence on what it does (under 25 words, no hype)
- audience: one sentence on who buys from it or follows it
- anchors: 10 well-known podcasts, brands, TV shows, people or artists whose audience is that same audience. Exact public names.
  Mix the kinds, mostly podcasts and brands. Nothing the business itself owns.
JSON: {"name": "", "about": "", "audience": "", "anchors": [{"name": "", "type": "podcast|brand|tv_show|person|artist|movie", "why": "under 12 words"}]}`, 1200);
  return { read: parseJson<Read>(r.text), cost: r.costUsd };
}

/** The model's picks that Qloo has under that exact name, at most three of a kind, so one kind doesn't become the whole read. */
async function inQloo(picks: Read["anchors"]): Promise<Anchor[]> {
  const typed = picks.filter(a => KINDS.includes(a.type as EntityType)).slice(0, 12);
  const hits = await Promise.all(typed.map(async a => {
    const e = await resolve(a.name, a.type as EntityType).catch(() => null);
    return e ? { id: e.id, name: e.name, type: a.type as EntityType, why: a.why?.slice(0, 120) || null } : null;
  }));
  const out: Anchor[] = [];
  for (const h of hits) {
    if (!h || out.some(o => o.id === h.id) || out.filter(o => o.type === h.type).length >= 3) continue;
    out.push(h);
    if (out.length >= PICK) break;
  }
  return out;
}

export const BUSINESS_WHY = {
  site: "That site didn't load for us, or there wasn't enough on it to read. Try the full address.",
  anchors: "We read the site but couldn't find enough things Qloo knows that share its audience. Try a page that says more about what you do.",
  full: "Today's new desks are all set up. Try again tomorrow, or open one of the judges' desks.",
} as const;

/** A desk for a business Qloo doesn't know, from its site. The existing one if someone set it up already. */
export async function setUpBusiness(input: string): Promise<{ ok: true; id: string } | { ok: false; why: keyof typeof BUSINESS_WHY }> {
  const site = siteOf(input);
  if (!site) return { ok: false, why: "site" };
  const entity = `site:${rootOf(site)}`;
  const [have] = (await sql()`select id from custom_desks where entity_id = ${entity}`) as { id: string }[];
  if (have) return { ok: true, id: have.id };
  const [{ n }] = (await sql()`select count(*)::int n from custom_desks where created_at > now() - interval '1 day'`) as { n: number }[];
  if (n >= DESKS_PER_DAY) return { ok: false, why: "full" };
  const got = await read(site).catch(() => null);
  if (!got?.read?.name) return { ok: false, why: "site" };
  const anchors = await inQloo(got.read.anchors ?? []);
  if (anchors.length < MIN) return { ok: false, why: "anchors" };
  const name = got.read.name.replace(/\s+/g, " ").trim().slice(0, 60);
  const about = [got.read.about, got.read.audience].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 320) || null;
  const id = `my-${slugify(name, 40) || "desk"}-${token(3).toLowerCase()}`;
  await sql()`insert into custom_desks (id, entity_id, name, type, image, site, about, anchors, anchors_at)
    values (${id}, ${entity}, ${name}, 'business', null, ${site}, ${about}, ${JSON.stringify(anchors)}, now()) on conflict (entity_id) do nothing`;
  const [row] = (await sql()`select id from custom_desks where entity_id = ${entity}`) as { id: string }[];
  await logAction({ agent: "scout", kind: "desk.anchored", llmCostUsd: got.cost,
    summary: `Set up a desk for ${name} from ${new URL(site).hostname}. Qloo has no record of it, so it reads through ${anchors.length} anchors Qloo does know: ${anchors.map(a => a.name).join(", ")}.`,
    detail: { persona: row.id, site, anchors } });
  return { ok: true, id: row.id };
}

export async function anchorsOf(deskId: string): Promise<Anchor[]> {
  const [r] = (await sql()`select anchors from custom_desks where id = ${deskId} and type = 'business'`) as { anchors: Anchor[] | null }[];
  return r?.anchors ?? [];
}

async function save(deskId: string, anchors: Anchor[], summary: string) {
  await sql()`update custom_desks set anchors = ${JSON.stringify(anchors)}, anchors_at = now() where id = ${deskId} and type = 'business'`;
  await logAction({ agent: "scout", kind: "desk.anchors_changed", summary, detail: { persona: deskId, anchors } });
}

/** The owner adds an anchor by name: Qloo's record with that name (any kind a desk can read), else the best-known close one. */
export async function addAnchor(deskId: string, name: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const q = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (q.length < 2) return { ok: false, why: "Type the name of a podcast, brand, show, person or artist." };
  const have = await anchorsOf(deskId);
  if (have.length >= MAX) return { ok: false, why: `A desk reads through ${MAX} anchors at most. Remove one first.` };
  const kindOf = (types?: string[]) => KINDS.find(k => (types ?? []).includes(`urn:entity:${k}`));
  const hits = (await search(q, undefined, 10).catch(() => [])).filter(e => kindOf(e.types));
  const e = hits.find(h => norm(h.name) === norm(q)) ?? hits.find(h => norm(h.name).includes(norm(q)));
  if (!e) return { ok: false, why: `Qloo has nothing called "${q}" that a desk can read. Try the full name.` };
  if (have.some(a => a.id === e.entity_id)) return { ok: false, why: `${e.name} is already an anchor.` };
  await save(deskId, [...have, { id: e.entity_id, name: e.name, type: kindOf(e.types)!, why: "added by the desk's owner" }],
    `The desk's owner added ${e.name} as an anchor.`);
  return { ok: true };
}

export async function removeAnchor(deskId: string, id: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const have = await anchorsOf(deskId);
  const gone = have.find(a => a.id === id);
  if (!gone) return { ok: true };
  if (have.length <= MIN) return { ok: false, why: `A desk needs at least ${MIN} anchors. Add another before removing this one.` };
  await save(deskId, have.filter(a => a.id !== id), `The desk's owner removed ${gone.name} as an anchor.`);
  return { ok: true };
}
