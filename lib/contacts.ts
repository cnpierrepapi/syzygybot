// Contact finder + Verifier.
// Finder: searches public pages (press releases, trade press, company sites) for the people who
// buy audience data at the chosen account, plus any role inboxes the company publishes. Never LinkedIn.
// Verifier: re-reads every cited page itself and keeps a person only if the page names them with the
// company and a matching role. Inbox addresses must appear on a page and their domain must take mail.
// Personal email addresses are never guessed.

import { sql } from "./db";
import { logAction } from "./actions";
import { askWeb, parseJson, type WebSource } from "./llm";
import { hasMx, monthsAgo, readAll, readPage, type Page } from "./web";

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

/** Company names on pages vary ("A24", "A24 Films"); match the distinctive first word. */
function companyOn(text: string, company: string) {
  const t = norm(text), c = norm(company);
  if (t.includes(c)) return true;
  const head = c.split(" ").find(w => w.length >= 3 && !["the", "and", "inc", "films", "records"].includes(w));
  return head ? new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t) : false;
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

export type Verdict = {
  status: "confirmed" | "stale" | "unconfirmed";
  page: string | null; date: string | null; checked: { url: string; http: number | null; name: boolean; company: boolean; role: boolean }[];
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
  if (!best) return { status: "unconfirmed", page: null, date: null, checked };
  return { status: best.fresh ? "confirmed" : "stale", page: best.p.url, date: best.p.date, checked };
}

const SITE_PATHS = ["", "/contact", "/contact-us", "/press", "/about", "/partnerships"];

export async function findContacts(a: Account) {
  const web = await askWeb(finderPrompt(a), FINDER_SYSTEM);
  const found = parseJson<Found>(web.text) ?? {};
  const people = (found.people ?? []).filter(p => p?.name && p?.title).slice(0, 5);
  const inboxes = (found.inboxes ?? []).filter(i => i?.email?.includes("@")).slice(0, 4);

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
  const allPages = [...pages, ...sitePages];

  // First pass over what the finder read; anyone not confirmed gets a second, independent search.
  const first = people.map(p => judgePerson(allPages, p.name, p.title, p.company || a.name, officialDomain));
  const recheck = await Promise.all(people.map(async (p, i) => {
    if (first[i].status === "confirmed") return { verdict: first[i], cost: 0 };
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
      verification: { ...v, claimed: { url: p.source_url ?? null, date: p.source_date ?? null } },
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
    if (c.role_status === "confirmed" && dup.role_status !== "confirmed") {
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
      : `Could not confirm ${c.name} on any page it read. Held back.`
      : c.role_status === "confirmed" ? `Confirmed ${mask(c.email!)}: published by ${a.name} and the domain takes mail.`
      : `Rejected ${mask(c.email!)}: not found on a page it could read, or the domain takes no mail.`;
  await logAction({ agent: "verifier", kind: `contact.${c.role_status}`, summary: verdict, refTable: "contacts", refId: row.id });
  return { id: row.id, kind: c.kind, status: c.role_status };
}
