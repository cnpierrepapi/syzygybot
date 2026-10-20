// Contact finder + Verifier.
// Finder: searches public pages (press releases, trade press, company sites) for the people who
// buy audience data at the chosen account, plus any role inboxes the company publishes. Never LinkedIn.
// Verifier: re-reads every cited page itself and keeps a person only if the page names them with the
// company and a matching role. Inbox addresses must appear on a page and their domain must take mail.
// Personal email addresses are never guessed.
// Two finders run side by side: a grounded web search, and the Source sweep (lib/sweep.ts) over the
// curated list of trade press, wires, conference and registry sources we can read.

import { sql } from "./db";
import { logAction } from "./actions";
import { askWeb, parseJson, type WebSource } from "./llm";
import { hasMx, monthsAgo, readAll, readPage, type Page } from "./web";
import { sweep } from "./sweep";

export type Account = { id: string; entity_id: string; name: string; type: string; official_site: string | null };

type Found = {
  people?: { name: string; title: string; company?: string; source_url?: string; source_date?: string }[];
  inboxes?: { email: string; purpose?: string; source_url?: string }[];
};

const WHO: Record<string, string> = {
  brand: "the chief marketing officer, heads of brand partnerships or sponsorships, and heads of consumer or audience insights",
  artist: "the artist's manager or management company, the head of marketing at their record label, and their brand-partnerships agent",
  tv_show: "the marketing and brand-partnership leads at the network or streamer that makes the show",
  movie: "the marketing and brand-partnership leads at the studio or distributor",
};

const FINDER_SYSTEM = `You are the Contact finder on an autonomous sales team. You find the people who would
buy audience-taste data, using only public pages: company sites, press releases, trade press (Variety,
Billboard, Adweek, Ad Age, The Hollywood Reporter), conference speaker pages and Wikipedia.
Never use or cite LinkedIn. Never guess or construct an email address. Prefer pages from the last two years.
Reply with JSON only, no prose.`;

function finderPrompt(a: Account) {
  return `Find ${WHO[a.type] ?? WHO.brand} for "${a.name}"${a.official_site ? ` (official site ${a.official_site})` : ""}.
Also list any email addresses the company itself publishes for partnerships, marketing, press, licensing or general contact.
JSON shape:
{"people":[{"name":"","title":"","company":"","source_url":"","source_date":"YYYY-MM-DD"}],
 "inboxes":[{"email":"","purpose":"","source_url":""}]}
At most 5 people and 4 inboxes. Every entry needs the exact public URL that states it.`;
}

const VERIFIER_SYSTEM = `You are the Verifier on an autonomous sales team. Search for public pages that show
whether a named person currently holds a role at a company. Never use LinkedIn. Answer in one or two lines.`;

const ROLE_WORDS = /market|partner|brand|insight|sponsor|creative|communicat|chief|head|director|president|vp|vice|manag|consumer|audience|growth|strateg|agent|licens/i;
const USEFUL_INBOX = /partner|market|brand|press|media|pr@|licens|sponsor|collab|info|hello|contact|business|booking|manage/i;
const USELESS_INBOX = /privacy|dpo|legal|order|shop|support|help|career|job|abuse|unsubscribe|noreply|no-reply|webmaster|investor|ir@|accessib/i;

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const domainOf = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, "") : null; } catch { return null; } };

/** Company names on pages vary ("A24", "A24 Films"); match the distinctive first word. Whole words only, so "Iope" doesn't
 * match the Italian "sciopero", but a space, hyphen or dot may split a name ("Oliveyoung" on file, "Olive Young" on the page). */
export function companyOn(text: string, company: string) {
  const t = norm(text), c = norm(company).replace(/[.,]+$/, "");
  const word = (w: string) => new RegExp(`(?<![a-z0-9])${[...w].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(w.length >= 6 ? "[\\s.-]?" : "")}(?![a-z0-9])`).test(t);
  if (word(c)) return true;
  const head = c.split(" ").find(w => w.length >= 3 && !["the", "and", "inc", "films", "records"].includes(w));
  return head ? word(head) : false;
}

function roleNearName(text: string, name: string, title: string) {
  const t = norm(text), n = norm(name);
  const titleWords = norm(title).split(/[^a-z]+/).filter(w => w.length > 3 && ROLE_WORDS.test(w));
  let i = t.indexOf(n);
  while (i >= 0) {
    const window = t.slice(Math.max(0, i - 300), i + n.length + 300);
    if (titleWords.length ? titleWords.some(w => window.includes(w)) : ROLE_WORDS.test(window)) return true;
    i = t.indexOf(n, i + 1);
  }
  return false;
}

// Someone who has left a role, or is on the way out, is never pitched. Two places say so:
// the title the finder returns ("SVP (Former CMO)", "Ex-CMO") and the page text around the name.
const words = (xs: string[]) => xs.map(x => (/[a-z0-9)]$/.test(x) ? String.raw`${x}\b` : x)).join("|");
const GONE_WORDS = [
  "former(?:ly)?", "ex-", "ex ", "previous(?:ly)?", "past", "outgoing", "departing", "departed", "retiring", "retired",
  "one-time", "onetime", "erstwhile", "then-", "emerit(?:us|a)", "until recently", "until (?:19|20)[0-9][0-9]", "no longer",
  "stepped down", "stepping down", "resigned", "left", "leaving", "interim until",
];
const TITLE_GONE = new RegExp(`(?:^|[^a-z])(?:${words(GONE_WORDS)})`, "i");
// Just before the name: "former Guess CMO Jane Doe", "the late Jane Doe", "succeeds Jane Doe".
const GONE_BEFORE = new RegExp(String.raw`\b(${words([
  "former(?:ly)?", "ex-", "previous", "outgoing", "departing", "retiring", "retired", "one-time", "onetime", "erstwhile",
  "then-", "the late", "succeeds", "succeeding", "replaces", "replacing", "takes over from", "taking over from", "successor to",
])})[^.;]{0,60}$`);
// Just after it: "Jane Doe, who stepped down in May". Not "formerly of Nike" or "who left Nike to join": those say
// where someone came FROM, so leaving needs this company named, or a plain exit verb.
const goneAfter = (company: string) => new RegExp(String.raw`^[^.;]{0,120}?\b(${words([
  "stepped down", "steps down", "stepping down", "will step down", "resigned", "resigns", "resigning", "retired", "retires",
  "retiring", "has departed", "is departing", "will depart", "departed the company", "parted ways",
  "no longer (?:with|at|works|serves|leads)", "was replaced", "has been replaced", "replaced by", "succeeded by", "is leaving",
  "will leave", "has left the company", "left the company", "until recently", "its outgoing", "the outgoing", "as outgoing",
  `(?:left|exited|exits|exiting|departed|departs|leaves|leaving) ${company}`,
])})`);
// Company names after norm() are letters, digits and the odd "&" or "'": any other character matches loosely.
const escapeRe = (s: string) => s.replace(/[^a-z0-9 ]/g, ".");

/**
 * Drops clauses that describe a past or ending role. "SVP & GM (Former Global CMO)" -> "SVP & GM";
 * "Former CMO" or "Outgoing CMO" -> gone, since the role itself is the one they're leaving.
 */
export function cleanTitle(title: string): { title: string; gone: boolean; dropped: string[] } {
  const dropped: string[] = [];
  let t = title.replace(/\s*[(\[]([^)\]]*)[)\]]/g, (m, inner: string) => (TITLE_GONE.test(inner) ? (dropped.push(inner.trim()), "") : m));
  const parts = t.split(/\s*(?:;|,|\s[-–—|]\s)\s*/).filter(Boolean);
  // "(until 2024)" or "(stepped down)" qualifies the whole title, not a second role.
  const ends = dropped.some(d => /^(until|stepped down|stepping down|resigned|retired|left|leaving|no longer)/i.test(d));
  if (ends || TITLE_GONE.test(parts[0] ?? "")) return { title: title.trim(), gone: true, dropped: [title.trim()] };
  const kept = parts.filter(x => !(TITLE_GONE.test(x) && (dropped.push(x.trim()), true)));
  if (!dropped.length) return { title: title.trim(), gone: false, dropped }; // nothing past in it: leave it exactly as written
  t = kept.join(", ").replace(/\s+/g, " ").trim();
  return t ? { title: t, gone: false, dropped } : { title: title.trim(), gone: true, dropped };
}

const SPAN_OK = new Set(["the", "of", "and", "its", "our", "longtime", "long-time", "global", "senior", "executive", "chief", "officer",
  "svp", "evp", "cmo", "cbo", "cco", "ceo", "cfo", "coo", "cxo", "us", "north", "america", "emea", "apac", "worldwide", "international", "company's", "brand's",
  "product", "lead", "leader", "general", "content", "digital", "social", "media", "sales", "business", "commercial", "operations", "experience",
  "design", "research", "data", "analytics", "public", "relations", "pr", "events", "culture", "community", "ecommerce", "e-commerce", "retail",
  "merchandising", "boss", "exec", "advertising", "campaigns", "integrated", "regional", "country", "group", "team", "member", "founding"]);
function beforeSpanOk(span: string, companyHead: string) {
  return span.split(/[^a-z0-9'&.-]+/).filter(Boolean)
    .every(w => w === companyHead || w.replace(/'s$/, "") === companyHead || SPAN_OK.has(w) || ROLE_WORDS.test(w));
}

/** The phrase on this page that says the person has left, if any, next to any mention of their name. */
export function goneOnPage(text: string, name: string, company: string): string | null {
  const t = norm(text), n = norm(name);
  const co = norm(company).split(" ").find(w => w.length >= 3 && !["the", "and", "inc"].includes(w)) ?? norm(company);
  const after = goneAfter(escapeRe(co));
  for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) {
    const before = GONE_BEFORE.exec(t.slice(Math.max(0, i - 80), i));
    // "former Guess CMO Jane Doe" counts; "ex-Booking.com CMO Jane Doe" says where she came from. So between the
    // marker and the name only this company and role words may appear.
    if (before && beforeSpanOk(before[0].slice(before[1].length), co)) return before[1];
    const aft = after.exec(t.slice(i + n.length, i + n.length + 160));
    if (aft) return aft[1];
  }
  return null;
}

export type Verdict = {
  status: "confirmed" | "stale" | "unconfirmed" | "departed";
  page: string | null; date: string | null; checked: { url: string; http: number | null; name: boolean; company: boolean; role: boolean }[];
  gone?: { url: string | null; date: string | null; phrase: string };
};

export function judgePerson(pages: Page[], name: string, title: string, company: string, officialDomain: string | null): Verdict {
  const checked: Verdict["checked"] = [];
  let best: { p: Page; fresh: boolean } | null = null;
  for (const p of pages) {
    const hasName = norm(p.text).includes(norm(name));
    const hasCo = hasName && companyOn(p.text, company);
    const hasRole = hasCo && roleNearName(p.text, name, title);
    checked.push({ url: p.url, http: p.status, name: hasName, company: hasCo, role: hasRole });
    if (!hasRole || p.status >= 400) continue;
    const age = monthsAgo(p.date);
    const own = officialDomain != null && domainOf(p.url)?.endsWith(officialDomain) === true;
    const fresh = own || (age != null && age <= 24);
    if (!best || (fresh && !best.fresh)) best = { p, fresh };
  }
  // A page saying they left wins, unless the confirming page is dated after it (they came back, or it's an old stint).
  let gone: Verdict["gone"];
  for (const p of pages) {
    if (p.status >= 400 || !companyOn(p.text, company)) continue;
    const phrase = goneOnPage(p.text, name, company);
    if (phrase && (!gone || (p.date ?? "") > (gone.date ?? ""))) gone = { url: p.url, date: p.date, phrase };
  }
  if (gone && !(best?.p.date && gone.date && best.p.date > gone.date))
    return { status: "departed", page: best?.p.url ?? gone.url, date: best?.p.date ?? null, checked, gone };
  if (!best) return { status: "unconfirmed", page: null, date: null, checked };
  return { status: best.fresh ? "confirmed" : "stale", page: best.p.url, date: best.p.date, checked };
}

const SITE_PATHS = ["", "/contact", "/contact-us", "/press", "/about", "/partnerships"];

export async function findContacts(a: Account) {
  const [ent] = (await sql()`select raw->'properties'->>'headquartered' hq, coalesce(raw->'tags', '[]'::jsonb) tags from entities where qloo_id = ${a.entity_id}`) as { hq: string | null; tags: { name?: string }[] }[];
  const [web, swept] = await Promise.all([
    askWeb(finderPrompt(a), FINDER_SYSTEM),
    sweep({ name: a.name, type: a.type, tags: (ent?.tags ?? []).map(t => t?.name ?? "").filter(Boolean), hq: ent?.hq ?? null }),
  ]);
  const found = parseJson<Found>(web.text) ?? {};
  const people = (found.people ?? []).filter(p => p?.name && p?.title).slice(0, 5);
  const inboxes = (found.inboxes ?? []).filter(i => i?.email?.includes("@")).slice(0, 4);
  // Sweep finds join the list; the date is the article's, so the Verifier's age rule applies to it.
  for (const sp of swept.people) {
    if (people.length >= 9) break;
    if (people.some(p => p.name.toLowerCase() === sp.name.toLowerCase())) continue;
    people.push({ name: sp.name, title: sp.title, company: a.name, source_url: sp.source_url, source_date: swept.hits.find(h => h.url === sp.source_url)?.date?.slice(0, 10) });
  }
  for (const si of swept.inboxes) if (!inboxes.some(i => i.email.toLowerCase() === si.email.toLowerCase())) inboxes.push({ email: si.email, purpose: "published in trade press", source_url: si.source_url });
  const via = (k: string) => swept.hits.filter(h => h.via === k).length;
  await logAction({
    agent: "contact_finder", kind: "contacts.swept",
    summary: `Swept ${swept.sourcesConsidered} listed sources for ${a.name} (${swept.groups.filter(g => !["wire", "business", "registry"].includes(g)).join(", ")}): ${via("bing_news")} news hits, ${via("search_feed")} from ${swept.feedsSearched} site searches${via("sec_8k") ? `, ${via("sec_8k")} SEC filings` : ""}. Read ${swept.pages.length}, found ${swept.people.length} named people.`,
    refTable: "accounts", refId: a.id, llmCostUsd: swept.costUsd,
    detail: { groups: swept.groups, queries: swept.queries, hits: swept.hits.slice(0, 40).map(h => ({ url: h.url, title: h.title, source: h.source, date: h.date, via: h.via })) },
  });

  await logAction({
    agent: "contact_finder", kind: "contacts.searched",
    summary: `Searched public pages for ${a.name}'s buyers: ${people.length} named people and ${inboxes.length} published inboxes to check.`,
    refTable: "accounts", refId: a.id, detail: { model: web.model, sources: web.sources.length }, llmCostUsd: web.costUsd,
  });

  // The Verifier reads everything itself: cited pages, search results, and the company's own site.
  const site = a.official_site?.replace(/\/$/, "") ?? null;
  const officialDomain = domainOf(site);
  const pages = await readAll([
    ...people.map(p => p.source_url ?? ""), ...inboxes.map(i => i.source_url ?? ""),
    ...web.sources.map((s: WebSource) => s.url),
  ]);
  const sitePages = site ? (await Promise.all(SITE_PATHS.map(p => readPage(site + p)))).filter((p): p is Page => p != null && p.status < 400) : [];
  const allPages = [...pages, ...sitePages, ...swept.pages];

  // Titles first: a past role in brackets is dropped, a title that is itself a past role marks them gone.
  const titles = people.map(p => cleanTitle(p.title));
  people.forEach((p, i) => { p.title = titles[i].title; });
  // First pass over what the finder read; anyone not confirmed gets a second, independent search.
  const first = people.map(p => judgePerson(allPages, p.name, p.title, p.company || a.name, officialDomain));
  const recheck = await Promise.all(people.map(async (p, i) => {
    if (titles[i].gone) return { verdict: { ...first[i], status: "departed" as const, gone: { url: p.source_url ?? null, date: p.source_date ?? null, phrase: titles[i].dropped[0] } }, cost: 0 };
    if (first[i].status === "confirmed" || first[i].status === "departed" || i >= 6) return { verdict: first[i], cost: 0 }; // second searches cost money; cap them
    try {
      const w = await askWeb(`Find public pages (not LinkedIn) that state "${p.name}" works at ${a.name}, and their current title. List the URLs.`, VERIFIER_SYSTEM, 400);
      const extra = await readAll(w.sources.map(s => s.url), 6);
      const v = judgePerson([...allPages, ...extra], p.name, p.title, p.company || a.name, officialDomain);
      return { verdict: { ...v, checked: [...first[i].checked, ...v.checked.slice(allPages.length)] }, cost: w.costUsd };
    } catch { return { verdict: first[i], cost: 0 }; }
  }));
  const recheckCost = recheck.reduce((x, r) => x + r.cost, 0);
  if (recheckCost) await logAction({
    agent: "verifier", kind: "contacts.rechecked",
    summary: `Ran a second search for ${recheck.filter(r => r.cost).length} of ${a.name}'s contacts the first pages did not confirm.`,
    refTable: "accounts", refId: a.id, llmCostUsd: recheckCost,
  });

  const saved: { id: string; kind: string; status: string }[] = [];
  for (const [i, p] of people.entries()) {
    const v = recheck[i].verdict;
    saved.push(await saveContact(a, {
      kind: "person", name: p.name, role: p.title, email: null, email_status: "unverified",
      sources: [p.source_url, v.page].filter(Boolean) as string[], role_status: v.status,
      verification: { ...v, claimed: { url: p.source_url ?? null, date: p.source_date ?? null }, ...(titles[i].dropped.length ? { titleDropped: titles[i].dropped } : {}) },
    }));
  }

  // Inboxes: must appear on a page we read, look like a business route, and the domain must take mail.
  const seenOnPages = new Map<string, string>();
  for (const pg of allPages) for (const e of pg.emails) if (!seenOnPages.has(e)) seenOnPages.set(e, pg.url);
  const siteInboxes = sitePages.flatMap(pg => pg.emails)
    .filter(e => !officialDomain || e.endsWith("@" + officialDomain) || e.endsWith("." + officialDomain));
  const candidates = [...new Set([...inboxes.map(i => i.email.toLowerCase().trim()), ...siteInboxes])];
  for (const email of candidates.slice(0, 6)) {
    if (USELESS_INBOX.test(email) || !USEFUL_INBOX.test(email)) continue;
    const page = seenOnPages.get(email) ?? null;
    const mx = await hasMx(email.split("@")[1]);
    const ok = page != null && mx;
    saved.push(await saveContact(a, {
      kind: "inbox", name: null, role: inboxes.find(i => i.email.toLowerCase() === email)?.purpose || "published company inbox",
      email, email_status: ok ? "role_inbox" : page ? "invalid" : "unverified",
      sources: page ? [page] : [], role_status: ok ? "confirmed" : "unconfirmed",
      verification: { publishedOn: page, mx },
    }));
  }
  return saved;
}

type NewContact = {
  kind: "person" | "inbox"; name: string | null; role: string; email: string | null; email_status: string;
  sources: string[]; role_status: Verdict["status"]; verification: Record<string, unknown>;
};

const mask = (e: string) => e.replace(/^(.)[^@]*/, "$1***");

async function saveContact(a: Account, c: NewContact) {
  const [dup] = (await sql()`
    select id, role_status from contacts where account_id = ${a.id}
      and ((${c.kind} = 'person' and lower(name) = lower(${c.name ?? ""})) or (${c.kind} = 'inbox' and lower(email) = lower(${c.email ?? ""})))`) as { id: string; role_status: string }[];
  if (dup) {
    // A later pass can confirm someone an earlier pass held back; keep the record, upgrade it.
    // Not someone already found to have left: only recheckDepartures' dated comparison can reverse that.
    if (c.role_status === "confirmed" && dup.role_status !== "confirmed" && dup.role_status !== "departed") {
      await sql()`update contacts set role_status = 'confirmed', role = ${c.role}, email = coalesce(${c.email}, email),
        email_status = ${c.email_status}, sources = ${JSON.stringify(c.sources)}, verified_at = now(), verification = ${JSON.stringify(c.verification)}
        where id = ${dup.id}`;
      await logAction({ agent: "verifier", kind: "contact.confirmed", summary: `Confirmed ${c.name ?? mask(c.email ?? "")} on a later pass: a newer page names them as ${c.role}.`, refTable: "contacts", refId: dup.id });
      return { id: dup.id, kind: c.kind, status: "confirmed" };
    }
    return { id: dup.id, kind: c.kind, status: "duplicate" };
  }
  const [row] = (await sql()`
    insert into contacts (account_id, kind, name, role, email, email_status, sources, role_status, verified_at, verification)
    values (${a.id}, ${c.kind}, ${c.name}, ${c.role}, ${c.email}, ${c.email_status}, ${JSON.stringify(c.sources)},
            ${c.role_status}, now(), ${JSON.stringify(c.verification)})
    returning id`) as { id: string }[];
  const who = c.kind === "person" ? `${c.name}, ${c.role}` : `inbox ${mask(c.email!)}`;
  await logAction({
    agent: "contact_finder", kind: "contact.found", summary: `Found ${who} at ${a.name}.`,
    refTable: "contacts", refId: row.id,
  });
  const verdict =
    c.kind === "person"
      ? c.role_status === "confirmed" ? `Confirmed ${c.name} as ${c.role}: the cited page names them in that role.`
      : c.role_status === "stale" ? `${c.name} is named, but only on pages over two years old. Held back.`
      : c.role_status === "departed" ? `${c.name} has left or is leaving the role ("${String((c.verification.gone as { phrase?: string } | undefined)?.phrase ?? "former")}"). Not pitched.`
      : `Could not confirm ${c.name} on any page it read. Held back.`
      : c.role_status === "confirmed" ? `Confirmed ${mask(c.email!)}: published by ${a.name} and the domain takes mail.`
      : `Rejected ${mask(c.email!)}: not found on a page it could read, or the domain takes no mail.`;
  await logAction({ agent: "verifier", kind: `contact.${c.role_status}`, summary: verdict, refTable: "contacts", refId: row.id });
  return { id: row.id, kind: c.kind, status: c.role_status };
}

/**
 * Re-reads the pages behind people already on file and applies the departure rules to them: a past role
 * in the title is dropped from it, and anyone who has left or is leaving stops being pitched (unsent steps
 * cancelled). Runs over confirmed people first; costs page fetches only, no model calls.
 */
export async function recheckDepartures(limit = 200) {
  const rows = (await sql()`
    select c.id, c.name, c.role, c.role_status, c.sources, c.verification, e.name company
    from contacts c join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    where c.kind = 'person' and c.name is not null and c.role_status <> 'departed'
    order by (c.role_status = 'confirmed') desc, c.verified_at desc nulls last limit ${limit}`) as {
      id: string; name: string; role: string; role_status: string; sources: string[]; company: string;
      verification: { page?: string | null; date?: string | null; claimed?: { url?: string | null } };
    }[];
  const out = { checked: rows.length, relabelled: 0, departed: 0 };
  for (const c of rows) {
    const t = cleanTitle(c.role);
    const pages = await readAll([c.verification.page ?? "", ...(c.sources ?? []), c.verification.claimed?.url ?? ""], 4);
    let gone: Verdict["gone"] = t.gone ? { url: null, date: null, phrase: t.dropped[0] } : undefined;
    for (const p of pages) {
      if (gone || !companyOn(p.text, c.company)) continue;
      const phrase = goneOnPage(p.text, c.name, c.company);
      // An older "former" mention doesn't override the newer page that confirmed them.
      if (phrase && !(c.verification.date && p.date && c.verification.date > p.date)) gone = { url: p.url, date: p.date, phrase };
    }
    if (gone) {
      await sql()`update contacts set role_status = 'departed', verified_at = now(),
        verification = verification || ${JSON.stringify({ gone, was: c.role_status })}::jsonb where id = ${c.id}`;
      const { stopSequence } = await import("./sequencer");
      await stopSequence({ contactId: c.id }, `${c.name} has left or is leaving the role`);
      await logAction({ agent: "verifier", kind: "contact.departed", summary: `${c.name} has left or is leaving ${c.company} ("${gone.phrase}"). Not pitched; unsent steps cancelled.`, refTable: "contacts", refId: c.id, detail: { correction: true } });
      out.departed++;
    } else if (t.title !== c.role) {
      await sql()`update contacts set role = ${t.title}, verification = verification || ${JSON.stringify({ titleDropped: t.dropped, titleWas: c.role })}::jsonb where id = ${c.id}`;
      await logAction({ agent: "verifier", kind: "contact.relabelled", summary: `Corrected ${c.name}'s title to ${t.title}: "${t.dropped.join("; ")}" was a past role.`, refTable: "contacts", refId: c.id });
      out.relabelled++;
    }
  }
  return out;
}
