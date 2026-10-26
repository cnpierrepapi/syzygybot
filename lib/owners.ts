// Who may send for real from a desk (24 Oct). Approving on a desk sends a real email or letter in that desk's voice, so the
// person approving proves once that the desk is theirs: a six-digit code sent to an email at the desk's own domain
// (you@livenation.com for the Live Nation desk). Until then, approvals on that desk are simulations.
import { createHash, randomInt } from "node:crypto";
import { sql } from "./db";
import { logAction } from "./actions";
import { loadPersona, customOf } from "./personas";
import { resolve } from "./live/qx";
import { fromAddress, transport } from "./mail";
import { askWeb, parseJson } from "./llm";
import { hasMx } from "./web";

// The desks written for the hackathon: their organisations' domains. Talent desks read their official site from Qloo.
const BUILT_IN: Record<string, string[] | { name: string; type: "artist" | "person" }> = {
  "live-nation-sponsorship": ["livenation.com"],
  "golden-globes-partnerships": ["goldenglobes.com"],
  "qloo-enterprise": ["qloo.com"],
  "twist-sponsorship": ["thisweekinstartups.com", "launch.co"],
  "bad-bunny-touring": { name: "Bad Bunny", type: "artist" },
  "cedric-brands": { name: "Cedric the Entertainer", type: "person" },
  // Studio clearance re-checks other desks' cards; a card sends from the desk that filed it.
  "studio-clearance": [],
};

// Personal mailboxes prove nothing about who owns a desk.
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|zoho|yandex|hey|fastmail|tutanota)\./i;

const UMBRELLA = /^(sonymusic|sonymusicentertainment|sony|umusic|universalmusic|umgstores|warnermusic|wmg|caa|wmeagency|wme|uta|unitedtalent|icmpartners|paradigmagency|livenation|aegpresents|atlanticrecords|rcarecords|columbiarecords|interscope|capitolrecords|republicrecords|epicrecords|def ?jam)\.(com|net)$/;

const CODE_TTL_MIN = 15, MAX_TRIES = 5, CODES_PER_DAY = 6;

const hostOf = (u: string | null | undefined) => {
  try { return u ? new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase() : null; } catch { return null; }
};
/** "shop.liquiddeath.com" -> "liquiddeath.com" (keeps two-part suffixes like co.uk). */
const rootOf = (h: string) => { const p = h.split("."); return p.slice(/\.(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(h) ? -3 : -2).join("."); };

/** The domains an owner's email may be at, for this desk. Empty means this desk can't be verified (yet). */
export async function deskDomains(personaId: string): Promise<string[]> {
  const [hit] = (await sql()`select domains from desk_domains where persona = ${personaId} and checked_at > now() - interval '30 days'`) as { domains: string[] }[];
  if (hit) return hit.domains;
  const p = await loadPersona(personaId);
  if (!p) return [];
  const fixed = BUILT_IN[personaId];
  let domains: string[] = [];
  const biz = customOf(personaId);
  if (Array.isArray(fixed)) domains = fixed;
  // A desk set up from a business's own site: that site's domain, if it takes email.
  else if (biz?.type === "business") {
    const h = hostOf(biz.site);
    const d = h ? rootOf(h) : null;
    if (d && !FREE_MAIL.test(`${d}.`) && await hasMx(d)) domains = [d];
  }
  else {
    const who = fixed ?? (() => { const e = customOf(personaId); return e ? { name: e.name, type: e.type } : null; })();
    const ent = who ? await resolve(who.name, who.type as never).catch(() => null) : null;
    const h = hostOf(ent?.site);
    if (h) domains = [rootOf(h)];
    // Qloo often has no site on record (Liquid Death, Bad Bunny): one web lookup for the domains its own team mails from.
    if (who) domains = [...new Set([...domains, ...await webDomains(who.name, who.type)])];
  }
  await sql()`insert into desk_domains (persona, domains) values (${personaId}, ${JSON.stringify(domains)})
    on conflict (persona) do update set domains = excluded.domains, checked_at = now()`;
  return domains;
}

async function webDomains(name: string, type: string) {
  const r = await askWeb(`What email domains does the team behind "${name}" (a ${type.replace("_", " ")}) use? Give the official website's domain, and
for an artist, person, show or podcast also the management company, label or production company whose staff handle its business.
Only domains you can source. JSON only: {"domains": [{"domain": "example.com", "source": ""}]}`,
    "You find official company domains from the organisation's own site and reputable press. Reply with JSON only.", 400).catch(() => null);
  // Majors and big agencies employ thousands who don't work for this act, so their domains prove nothing about the desk.
  const found = (parseJson<{ domains: { domain: string }[] }>(r?.text ?? "")?.domains ?? [])
    .map(d => hostOf(d.domain)).filter((d): d is string => !!d && !FREE_MAIL.test(`${d}.`)).map(rootOf).filter(d => !UMBRELLA.test(d));
  const ok = await Promise.all([...new Set(found)].slice(0, 4).map(async d => (await hasMx(d)) ? d : null));
  return ok.filter((d): d is string => !!d);
}

const domainMatch = (email: string, domains: string[]) => {
  const d = email.split("@")[1]?.toLowerCase() ?? "";
  return !FREE_MAIL.test(d) && domains.some(x => d === x || d.endsWith(`.${x}`));
};

export type Owner = { email: string; verified_at: string };

export async function ownerOf(workspaceId: string | null | undefined, personaId: string): Promise<Owner | null> {
  if (!workspaceId) return null;
  const [o] = (await sql()`select email, verified_at from desk_owners where workspace_id = ${workspaceId} and persona = ${personaId}`) as Owner[];
  return o ?? null;
}

/** Desks this workspace has verified, for pages that show cards from several desks. */
export async function ownedDesks(workspaceId: string | null | undefined) {
  if (!workspaceId) return new Set<string>();
  return new Set(((await sql()`select persona from desk_owners where workspace_id = ${workspaceId}`) as { persona: string }[]).map(r => r.persona));
}

export async function pendingCode(workspaceId: string, personaId: string) {
  const [c] = (await sql()`select email from owner_codes where workspace_id = ${workspaceId} and persona = ${personaId} and expires_at > now() and tries < ${MAX_TRIES}`) as { email: string }[];
  return c?.email ?? null;
}

const hash = (code: string, workspaceId: string) => createHash("sha256").update(`syzygy-owner:${workspaceId}:${code}`).digest("hex");

/** Emails a six-digit code to an address at the desk's domain. */
export async function sendCode(workspaceId: string, personaId: string, rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) return { ok: false as const, why: "That doesn't look like an email address." };
  const domains = await deskDomains(personaId);
  if (!domains.length) return { ok: false as const, why: "This desk has no company domain on record, so it can't be verified yet. Approvals here stay simulations." };
  if (!domainMatch(email, domains)) return { ok: false as const, why: `Use an email at ${domains.join(" or ")}. That's how we know the desk is yours.` };
  const [{ n }] = (await sql()`select count(*)::int n from actions where kind = 'owner.code_sent' and detail->>'workspace' = ${workspaceId} and created_at > now() - interval '1 day'`) as { n: number }[];
  if (n >= CODES_PER_DAY) return { ok: false as const, why: "Too many codes today. Try again tomorrow." };
  const p = await loadPersona(personaId);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await sql()`insert into owner_codes (workspace_id, persona, email, code_hash, expires_at, tries)
    values (${workspaceId}, ${personaId}, ${email}, ${hash(code, workspaceId)}, now() + make_interval(mins => ${CODE_TTL_MIN}), 0)
    on conflict (workspace_id, persona) do update set email = excluded.email, code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0, created_at = now()`;
  await transport().sendMail({
    from: `"SYZYGY" <${fromAddress()}>`, to: email, subject: `Your SYZYGY code: ${code}`,
    text: `Your code for ${p?.title ?? "your desk"} on SYZYGY is ${code}. It expires in ${CODE_TTL_MIN} minutes.\n\nOnce it's entered, approving a card on that desk sends a real email or letter in the desk's name.\nIf you didn't ask for this, ignore it and nothing changes.`,
  });
  await logAction({ agent: "verifier", kind: "owner.code_sent", summary: `Sent a desk-owner code for ${p?.title ?? personaId} to an address at ${email.split("@")[1]}.`, detail: { workspace: workspaceId, persona: personaId } });
  return { ok: true as const };
}

export async function verifyCode(workspaceId: string, personaId: string, code: string) {
  const [c] = (await sql()`update owner_codes set tries = tries + 1 where workspace_id = ${workspaceId} and persona = ${personaId}
    and expires_at > now() and tries < ${MAX_TRIES} returning email, code_hash`) as { email: string; code_hash: string }[];
  if (!c) return { ok: false as const, why: "That code has expired. Ask for a new one." };
  if (c.code_hash !== hash(code.replace(/\D/g, ""), workspaceId)) return { ok: false as const, why: "That code doesn't match." };
  await sql()`insert into desk_owners (workspace_id, persona, email) values (${workspaceId}, ${personaId}, ${c.email})
    on conflict (workspace_id, persona) do update set email = excluded.email, verified_at = now()`;
  await sql()`delete from owner_codes where workspace_id = ${workspaceId} and persona = ${personaId}`;
  const p = await loadPersona(personaId);
  await logAction({ agent: "verifier", kind: "owner.verified", summary: `${p?.title ?? personaId} verified by an address at ${c.email.split("@")[1]}. Approvals there now send for real.`, detail: { workspace: workspaceId, persona: personaId } });
  return { ok: true as const };
}
