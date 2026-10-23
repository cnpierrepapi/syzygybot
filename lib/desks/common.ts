// Shared machinery for the desks: find the buyer, find the inbox, check the talent's deals, draft, and re-run Clearance.
// A live run (lib/live/run.ts) decides WHO to approach and WHY; these steps work the same for every desk.
import { sql } from "../db";
import { logAction } from "../actions";
import { ask, askWeb, parseJson } from "../llm";
import { hasMx, readAll } from "../web";
import { clear, countryFromRole, emailAllowed, type Deal } from "../clearance";
import { cleanTitle, judgePerson } from "../contacts";
import { sweep } from "../sweep";
import { googleNews } from "../gnews";
import { findEmail, usable } from "../hunter";
import type { Match } from "../match";
import { MEETING_ASK, UNMEASURED } from "../outreach";

export type Purpose = "booking" | "sponsorship" | "partnerships" | "advertising" | "insights" | "management";

const PURPOSE_WORDS: Record<Purpose, string> = {
  booking: "booking, events, rentals or venue hire",
  sponsorship: "sponsorship, partnerships or marketing",
  partnerships: "brand partnerships, marketing, licensing or press",
  advertising: "advertising sales, sponsorship or partnerships",
  insights: "consumer insights, data partnerships or marketing",
  management: "management, booking or business inquiries for the artist",
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
- If recipient_person is given, write to that person by name (and if delivered_via says it's a shared inbox, say it's for their attention).
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

const BUYER: Record<Purpose, string> = {
  booking: "books the room: head of booking, director of events or event sales, programming director or general manager",
  sponsorship: "sells or buys sponsorship: head of partnerships, sponsorship director, VP brand partnerships or CMO",
  partnerships: "runs brand partnerships or marketing: head of brand partnerships, CMO, VP marketing or brand director",
  advertising: "sells advertising or partnerships: head of ad sales, partnerships director or VP sales",
  insights: "buys audience data: head of consumer insights, VP insights and analytics, head of data partnerships or CMO",
  management: "manages or books them: their manager, their booking agent at an agency, or the head of their management company",
};

const BUYER_TITLE: Record<Purpose, RegExp> = {
  booking: /book|event|programm|general manager|\bgm\b|venue|director of sales|sales director/i,
  sponsorship: /sponsor|partner|marketing|brand|\bcmo\b|commercial|revenue/i,
  partnerships: /partner|marketing|brand|\bcmo\b|\bcbo\b|licens/i,
  advertising: /advertis|ad sales|partner|sponsor|revenue|sales/i,
  insights: /insight|analytic|data|research|strateg|marketing|\bcmo\b/i,
  management: /manag|agent|booking|agency|represent/i,
};

export type Buyer = { name: string; role: string; page: string; date: string | null; email: string | null; emailSource: "verified" | null };

/** The named person at this org who handles this purpose, verified on a public page by the Verifier's own rules, with
 *  a Hunter-verified work address where the country allows one. Cached per org and purpose: 30 days when found, 3 when not. */
// Live runs pass { hunter: false, sweep: false }: Hunter credits are nearly gone, and the trade-press sweep is the slowest step.
export async function findBuyer(org: string, site: string | null, purpose: Purpose, country: string, opts: { hunter?: boolean; sweep?: boolean } = {}): Promise<Buyer | null> {
  const [hit] = (await sql()`select name, role, page, page_date, status, email, email_source from org_people
    where org = ${org} and purpose = ${purpose}
      and checked_at > now() - (case when status = 'confirmed' then interval '30 days' else interval '3 days' end)`) as any[];
  if (hit) return hit.status === "confirmed" ? { name: hit.name, role: hit.role, page: hit.page, date: hit.page_date, email: hit.email, emailSource: hit.email_source } : null;
  const domain = site ? site.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] : null;
  // A refused search (rate limit) isn't a "not found": nothing is cached, so the next run asks again.
  const r = await askWeb(`Who at "${org}"${site ? ` (${site})` : ""} ${BUYER[purpose]} today? Name up to three people currently in that kind of
role, each with the public page that says so (the organisation's own site, a press release or trade press; never LinkedIn) and its date.
JSON only: {"people": [{"name": "", "title": "", "source_url": "", "date": "YYYY-MM-DD"}]}`, "You find the named person who makes a business decision. Reply with JSON only. Leave out anyone you can't source.", 700).catch(() => null);
  if (!r) return null;
  const people = (parseJson<{ people: { name: string; title: string; source_url?: string }[] }>(r.text)?.people ?? []).filter(p => p.name && p.title).slice(0, 3);
  let found: Buyer | null = null;
  for (const p of people) {
    const t = cleanTitle(p.title);
    if (t.gone) continue;
    // Model-written URLs are often invented, so the person is also looked up in Google News ourselves and judged only
    // on pages we actually read.
    let pages = await readAll([p.source_url ?? "", ...r.sources.map(s => s.url)].filter(Boolean), 6);
    let v = judgePerson(pages, p.name, t.title, org, domain);
    if (v.status !== "confirmed") {
      const news = await googleNews(`"${p.name}" "${org.replace(/"/g, "")}"`, { max: 4 });
      pages = await readAll(news.map(n => n.url), 4);
      v = judgePerson(pages, p.name, t.title, org, domain);
    }
    // Venues and small companies name their people on their own site more often than in the press.
    if (v.status !== "confirmed" && domain) {
      pages = await readAll(["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/staff", "/press"].map(x => `https://${domain}${x}`), 8);
      v = judgePerson(pages, p.name, t.title, org, domain);
    }
    if (v.status === "confirmed" && v.page) { found = { name: p.name, role: t.title, page: v.page, date: v.date, email: null, emailSource: null }; break; }
  }
  // One search came back empty: sweep the trade press, Google News and the org's site the way the Contact finder does,
  // and judge every named person on the page they came from.
  if (!found && opts.sweep !== false) {
    const sw = await sweep({ name: org, type: purpose === "booking" ? "place" : "brand" }).catch(() => null);
    for (const p of (sw?.people ?? []).filter(p => BUYER_TITLE[purpose].test(p.title))) {
      const t = cleanTitle(p.title);
      if (t.gone) continue;
      const v = judgePerson(sw!.pages, p.name, t.title, org, domain);
      if (v.status === "confirmed" && v.page) { found = { name: p.name, role: t.title, page: v.page, date: v.date, email: null, emailSource: null }; break; }
    }
  }
  if (found && domain && opts.hunter !== false && emailAllowed(countryFromRole(found.role) ?? country, "verified")) {
    const [first, ...rest] = found.name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/);
    const h = rest.length ? await findEmail(domain, first, rest.join(" "), { spent: 0, cap: 1 }).catch(() => ({ refused: "error" as const })) : { refused: "no surname" as const };
    if (!("refused" in h) && usable(h.found)) { found.email = h.found.email; found.emailSource = "verified"; }
  }
  await sql()`insert into org_people (org, purpose, name, role, page, page_date, status, email, email_source, detail)
    values (${org}, ${purpose}, ${found?.name ?? null}, ${found?.role ?? null}, ${found?.page ?? null}, ${found?.date ?? null}, ${found ? "confirmed" : "not_found"},
      ${found?.email ?? null}, ${found?.emailSource ?? null}, ${JSON.stringify({ candidates: people })})
    on conflict (org, purpose) do update set name = excluded.name, role = excluded.role, page = excluded.page, page_date = excluded.page_date,
      status = excluded.status, email = excluded.email, email_source = excluded.email_source, detail = excluded.detail, checked_at = now()`;
  await logAction({ agent: "contact_finder", kind: found ? "buyer.found" : "buyer.not_found",
    summary: found ? `Found who decides at ${org}: ${found.name}, ${found.role}, confirmed on a public page${found.email ? "; Hunter verified their work address" : ""}.`
      : `Couldn't confirm a named person at ${org} for ${purpose} yet; it gets searched again in 3 days.`, llmCostUsd: r.costUsd });
  return found;
}

