// Shared machinery for every desk: watch → match → find the buyer → draft → Clearance → permission request.
// A desk only decides WHO to approach and WHY; finding the address, writing and clearing work the same everywhere.
import { sql } from "../db";
import { logAction, type Agent } from "../actions";
import { ask, askWeb, parseJson } from "../llm";
import { hasMx, readAll } from "../web";
import { slugify, token } from "../slug";
import { clear, countryFromRole, countryOf, type Deal, type Outbound } from "../clearance";
import type { Match } from "../match";
import { rejectionNotes } from "../desk";
import { MEETING_ASK, UNMEASURED } from "../outreach";
import type { DeskId, Persona } from "../personas";

export type Purpose = "booking" | "sponsorship" | "partnerships" | "advertising";

const PURPOSE_WORDS: Record<Purpose, string> = {
  booking: "booking, events, rentals or venue hire",
  sponsorship: "sponsorship, partnerships or marketing",
  partnerships: "brand partnerships, marketing, licensing or press",
  advertising: "advertising sales, sponsorship or partnerships",
};

const USEFUL = /book|event|rent|hire|sponsor|partner|market|licens|press|media|advert|sales|business|info|contact|hello/i;
const USELESS = /noreply|no-reply|privacy|legal|careers|jobs|support|help|abuse|webmaster|example|sentry|wixpress|domain/i;

/** A published inbox for this purpose, or a postal address for a letter. Cached per org and purpose. */
export async function findInbox(org: string, site: string | null, purpose: Purpose) {
  const [hit] = (await sql()`select email, url, postal, status from org_contacts where org = ${org} and purpose = ${purpose}
    and checked_at > now() - interval '30 days'`) as { email: string | null; url: string | null; postal: string | null; status: string }[];
  if (hit) return { ...hit, cost: 0 };
  const r = await askWeb(`Find the email address that "${org}"${site ? ` (${site})` : ""} publishes for ${PURPOSE_WORDS[purpose]}, and its
business postal address. Use the organisation's own website first. Never guess or construct an address.
JSON only: {"email": "", "source_url": "", "postal": ""}`, "You find published business contact details. Reply with JSON only.", 400);
  const j = parseJson<{ email?: string; source_url?: string; postal?: string }>(r.text);
  // The address only counts if it appears on a page we read ourselves (model-written URLs are often wrong).
  const pages = await readAll([j?.source_url ?? "", site ?? "", ...r.sources.map(s => s.url)], 6);
  const seen = pages.flatMap(p => p.emails.map(e => ({ e, url: p.url }))).filter(x => !USELESS.test(x.e));
  const wanted = j?.email?.toLowerCase().trim();
  const pick = seen.find(x => x.e === wanted) ?? seen.find(x => USEFUL.test(x.e.split("@")[0]));
  const ok = !!pick && await hasMx(pick.e.split("@")[1]);
  const row = { email: ok ? pick!.e : null, url: ok ? pick!.url : null, postal: j?.postal?.trim() || null, status: ok ? "published" : "not_found" };
  await sql()`insert into org_contacts (org, purpose, email, url, postal, status, detail)
    values (${org}, ${purpose}, ${row.email}, ${row.url}, ${row.postal}, ${row.status}, ${JSON.stringify({ asked: wanted ?? null, read: pages.map(p => p.url) })})
    on conflict (org, purpose) do update set email = excluded.email, url = excluded.url, postal = excluded.postal, status = excluded.status,
      detail = excluded.detail, checked_at = now()`;
  return { ...row, cost: r.costUsd };
}

/** The talent's known brand deals (for the exclusivity check), read from the web once a fortnight. */
export async function talentDeals(talent: string): Promise<Deal[]> {
  const [hit] = (await sql()`select deals from talent_deals where talent = ${talent} and checked_at > now() - interval '14 days'`) as { deals: Deal[] }[];
  if (hit) return hit.deals;
  const r = await askWeb(`List the brand deals and endorsement partnerships "${talent}" has had in the last four years: brand, product category
(e.g. sportswear, beer, fashion, phones), whether it is reported as exclusive or long-term, the year, and a source URL.
JSON only: {"deals": [{"brand": "", "category": "", "exclusive": true|false, "year": 2025, "source": ""}]}`,
    "You research celebrity brand deals from reputable press. Reply with JSON only. Leave out anything you can't source.", 900);
  const deals = (parseJson<{ deals: Deal[] }>(r.text)?.deals ?? []).filter(d => d.brand && d.category);
  await sql()`insert into talent_deals (talent, deals, sources) values (${talent}, ${JSON.stringify(deals)}, ${JSON.stringify(r.sources.slice(0, 8))})
    on conflict (talent) do update set deals = excluded.deals, sources = excluded.sources, checked_at = now()`;
  return deals;
}

const WRITER = `You write one short outbound message for a desk on SYZYGY, an AI agent team for entertainment partnerships.
Hard rules:
- The first sentence says plainly that an AI agent (SYZYGY) drafted this for the sender named in the brief, and a person approved it.
- Use only facts and numbers from the brief. SYZYGY's match score is out of 100 and is SYZYGY's own estimate: call it "our match score".
  Describe it by how it was built (as the brief says); never say Qloo hasn't measured, rated or scored something.
  Qloo affinity numbers are 0 to 1 scores from Qloo's taste data: credit them as Qloo's, never as percentages. Never claim to be Qloo.
- Talent appears only as audience data ("Bad Bunny's fans lean toward..."), never as liking, using or backing anything.
- One clear ask, answered by a reply. Never ask for a call, a meeting or a time slot; a person takes over after a reply. Under 140 words. No em dashes, no exclamation marks, no hype words.
- Sign as the sender in the brief.
Reply with JSON only: {"subject": "", "body": ""}`;

const style = (b: string, subject: string) => ({
  no_em_dash: !/—/.test(`${subject}${b}`),
  no_percent: !/%|\bper ?cent\b/i.test(`${subject}${b}`),
  short: b.split(/\s+/).length <= 170,
  discloses: /\bai\b/i.test(b.slice(0, 260)),
  no_meeting_ask: !MEETING_ASK.test(`${subject}\n${b}`),
  no_unmeasured_note: !UNMEASURED.test(`${subject}\n${b}`),
});

export async function draft(brief: Record<string, unknown>) {
  let cost = 0, last: { subject: string; body: string } | null = null, broke: Record<string, boolean> = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ask("write", WRITER, attempt ? `${JSON.stringify(brief)}\n\nYour last draft broke a rule: ${JSON.stringify(broke)}. Fix it.` : JSON.stringify(brief), 450);
    cost += r.costUsd ?? 0;
    last = parseJson<{ subject: string; body: string }>(r.text);
    if (!last?.body) continue;
    broke = style(last.body, last.subject ?? "");
    if (Object.values(broke).every(Boolean)) break;
  }
  return { draft: last?.body ? { subject: last.subject ?? "", body: last.body } : null, cost };
}

export type Evidence = {
  match?: Match | null;
  pattern?: { pct: number; strength: string; lookalikes: string[] } | null;  // look-alike match for an unmeasured subject
  facts: string[];
};

export type RequestInput = {
  persona: Persona; desk: DeskId; agent: Agent;
  action: "email" | "letter" | "hold_request" | "sponsor_pitch" | "ambassador_pitch" | "podcast_pitch" | "crm_push";
  title: string; dedupe: string;
  target: { org: string; site?: string | null; person?: string | null; role?: string | null; country: string; purpose: Purpose };
  brief: Record<string, unknown>;
  evidence: Evidence;
  talent?: string[]; targetBrand?: string | null; talentDeals?: Deal[];
  ref?: { table: string; id: string };
  // A message another agent already wrote (the Sales chain's Writer): filed as-is, no new draft or address search.
  preset?: { subject: string; body: string; address: string | null; roleStatus?: string | null; person?: string | null; addressSource?: "published" | "verified" };
};

/** Re-run Clearance on stored requests (after a rule changes). Edited copies are re-cleared when they're decided. */
export async function reclear(where: { persona?: string } = {}) {
  // A CRM push isn't a message to anyone, so the message rules don't apply to it.
  const rows = (await sql()`select id, target, preview, evidence from permission_requests where action <> 'crm_push'
    and (${where.persona ?? null}::text is null or persona = ${where.persona ?? null})`) as
    { id: string; target: Record<string, any>; preview: { subject: string; body: string }; evidence: Evidence }[];
  let held = 0;
  for (const r of rows) {
    const talent: string[] = r.target.talent ?? [];
    const c = await clear({
      channel: r.target.channel, subject: r.preview.subject, body: r.preview.body, address: r.target.address ?? null,
      addressSource: r.target.address ? "published" : null, roleStatus: r.target.roleStatus ?? null, country: r.target.country, talent,
      targetBrand: r.target.brand ?? null, talentDeals: talent.length === 1 && r.target.brand ? await talentDeals(talent[0]) : [],
      usesQloo: !!r.evidence.match?.qloo || r.evidence.facts.some(f => /qloo's taste data/i.test(f)),
    });
    if (c.status === "hold") held++;
    await sql()`update permission_requests set clearance = ${JSON.stringify(c)} where id = ${r.id}`;
  }
  return { checked: rows.length, held };
}

/** Find the address, write, clear, file. Returns null when the request already exists or the writer couldn't keep the rules. */
export async function makeRequest(x: RequestInput) {
  const [dup] = (await sql()`select id from permission_requests where dedupe = ${x.dedupe}`) as { id: string }[];
  if (dup) return null;
  const inbox = x.preset ? { email: x.preset.address, url: null, postal: null, cost: 0 } : await findInbox(x.target.org, x.target.site ?? null, x.target.purpose);
  const { draft: d, cost } = x.preset ? { draft: { subject: x.preset.subject, body: x.preset.body }, cost: 0 }
    : await draft({ ...x.brief, sender: x.brief.sender ?? x.persona.title, recipient: x.target.org,
        // Reasons people gave when they rejected this desk's earlier drafts: the writer takes them as standing notes.
        notes_from_rejections: await rejectionNotes(x.persona.id, x.desk) });
  if (!d) {
    await logAction({ agent: x.agent, kind: "request.discarded", summary: `Dropped a draft to ${x.target.org}: it broke a writing rule twice.`, llmCostUsd: cost + inbox.cost, detail: { persona: x.persona.id, desk: x.desk } });
    return null;
  }
  const channel = inbox.email ? "email" : "letter";
  const o: Outbound = {
    channel, subject: d.subject, body: d.body, address: inbox.email, addressSource: inbox.email ? (x.preset?.addressSource ?? "published") : null,
    roleStatus: x.preset?.roleStatus ?? null,
    country: countryFromRole(x.target.role) ?? countryOf(inbox.email, x.target.country), talent: x.talent ?? [], targetBrand: x.targetBrand ?? null,
    talentDeals: x.talentDeals, usesQloo: !!x.evidence.match?.qloo || x.evidence.facts.some(f => /qloo's taste data/i.test(f)),
  };
  const clearance = await clear(o);
  // Talent and brand ride on the target so Clearance can be re-run later with the same inputs.
  const target = { ...x.target, talent: x.talent ?? [], brand: x.targetBrand ?? null, person: x.preset?.person ?? x.target.person ?? null, roleStatus: x.preset?.roleStatus ?? null, address: inbox.email, source: inbox.url, postal: inbox.postal, channel, country: o.country };
  const [row] = (await sql()`
    insert into permission_requests (persona, desk, action, title, target, preview, evidence, clearance, dedupe, ref_table, ref_id, slug)
    values (${x.persona.id}, ${x.desk}, ${x.action}, ${x.title}, ${JSON.stringify(target)}, ${JSON.stringify(d)}, ${JSON.stringify(x.evidence)},
            ${JSON.stringify(clearance)}, ${x.dedupe}, ${x.ref?.table ?? null}, ${x.ref?.id ?? null}, ${`${slugify(x.title, 50)}-${token(4).toLowerCase()}`})
    on conflict (dedupe) do nothing returning id`) as { id: string }[];
  if (!row) return null;
  const held = clearance.checks.filter(c => !c.pass);
  await logAction({
    agent: x.agent, kind: "request.drafted",
    summary: `${x.title}: drafted ${channel === "email" ? "an email" : "a letter"} to ${x.target.org} and asked for permission to send.`,
    refTable: "permission_requests", refId: row.id, llmCostUsd: cost + inbox.cost, detail: { persona: x.persona.id, desk: x.desk },
  });
  await logAction({
    agent: "clearance", kind: held.length ? "request.held" : "request.cleared",
    summary: held.length ? `Held the ${x.target.org} draft: ${held.map(h => h.label.toLowerCase()).join(", ")}.` : `Cleared the ${x.target.org} draft on ${clearance.checks.length} rules.`,
    refTable: "permission_requests", refId: row.id, detail: { persona: x.persona.id, desk: x.desk },
  });
  return row.id;
}
