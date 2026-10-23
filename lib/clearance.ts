// Clearance: the release gate. Every outbound action passes these checks before it becomes a permission request, and the
// record rides on the card. A failed rule doesn't kill the draft: it lands on hold with the reason, for a person to clear.
// The rules are settings, so a clearance lead can tighten or loosen them per workspace (Rules below).
import { ask, parseJson } from "./llm";
import { SENSITIVE } from "./match";

export type Rules = {
  disclosure: boolean;        // AI disclosure in the opening lines (EU AI Act Art. 50, applies since 2 Aug 2026)
  endorsement: boolean;       // talent named only as audience data, never as backing a brand
  country: boolean;           // the sending rules where the recipient is
  germanyLetterOnly: boolean; // Germany: B2B email needs prior consent (UWG §7), so email holds and letters go
  publishedOnly: boolean;     // only addresses a company published; never a guessed personal email
  departed: boolean;          // never pitch someone who has left the role
  exclusivity: boolean;       // the talent has no exclusive deal in the target's category
};

export const DEFAULT_RULES: Rules = {
  disclosure: true, endorsement: true, country: true, germanyLetterOnly: true, publishedOnly: true, departed: true, exclusivity: true,
};

export const RULE_LABEL: Record<keyof Rules, string> = {
  disclosure: "AI disclosure up front",
  endorsement: "No implied endorsement",
  country: "Sending rules for the recipient's country",
  germanyLetterOnly: "Germany: letters only without consent",
  publishedOnly: "Published addresses only",
  departed: "Never pitch someone who left the role",
  exclusivity: "No category-exclusivity conflict",
};

export type Check = { rule: keyof Rules | "data"; label: string; pass: boolean; note: string };
export type Clearance = { status: "pass" | "hold"; checks: Check[]; checkedAt: string };

export type Deal = { brand: string; category: string; exclusive: boolean; year: number | null; source: string };

export type Outbound = {
  channel: "email" | "letter";
  subject: string;
  body: string;
  address: string | null;                            // email address (null for a letter)
  addressSource: "published" | "verified" | "guessed" | null; // published by the company, or found + verified by a service (Hunter)
  roleStatus?: string | null;                        // contacts.role_status for a named person
  country: string;                                   // ISO-2 of the recipient
  talent: string[];                                  // talent named in the message
  targetBrand?: string | null;                       // the brand being pitched, for the exclusivity check
  talentDeals?: Deal[];                              // known brand deals of the talent named
  usesQloo: boolean;                                 // the message quotes Qloo numbers
};

const EU = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);
const TLD_COUNTRY: Record<string, string> = { de: "DE", ca: "CA", uk: "GB", fr: "FR", es: "ES", it: "IT", nl: "NL", mx: "MX", pr: "US", do: "DO", ie: "IE", mt: "MT", se: "SE", br: "BR", co: "CO", ar: "AR", cl: "CL", au: "AU", jp: "JP" };

/** The recipient's country: the address's country domain if it has one, else what the desk knows about the target. */
export function countryOf(address: string | null, fallback: string) {
  const tld = address?.split(".").pop()?.toLowerCase();
  return (tld && TLD_COUNTRY[tld]) || fallback;
}

// A role written for a region ("Head of Marketing, Australia and New Zealand") says where the person works, whatever
// the address's domain says (@hm.com reads as US).
const ROLE_COUNTRY: [RegExp, string][] = [
  [/\baustralia\b|\banz\b/i, "AU"], [/\bnew zealand\b/i, "NZ"], [/\bcanada\b/i, "CA"], [/\b(united kingdom|uk)\b/i, "GB"],
  [/\bgermany\b|\bdach\b/i, "DE"], [/\bfrance\b/i, "FR"], [/\bitaly\b/i, "IT"], [/\bspain\b/i, "ES"], [/\bmexico\b/i, "MX"],
  [/\bjapan\b/i, "JP"], [/\bbrazil\b/i, "BR"], [/\bireland\b/i, "IE"], [/\bnetherlands\b|\bbenelux\b/i, "NL"],
];
export const countryFromRole = (role: string | null | undefined) => (role ? ROLE_COUNTRY.find(([re]) => re.test(role))?.[1] ?? null : null);

/** What each country's rule asks of a cold B2B message, and whether this one meets it. */
function countryRule(o: Outbound, rules: Rules): Check {
  const label = RULE_LABEL.country;
  const c = o.country;
  if (o.channel === "letter") return { rule: "country", label, pass: true, note: `Postal letter to ${c}: no consent rule applies to business post.` };
  // A service-verified address isn't one the company published: fine under CAN-SPAM, held where consent leans on publication.
  const published = o.addressSource === "published";
  if (c === "DE" && rules.germanyLetterOnly)
    return { rule: "country", label, pass: false, note: "Germany (UWG §7): cold B2B email needs prior consent. Send it as a letter instead." };
  if (c === "CA")
    return { rule: "country", label, pass: published, note: published ? "Canada (CASL): implied consent, because the address is published and the message fits the role. Unsubscribe and sender ID included." : "Canada (CASL): only a conspicuously published business address gives implied consent." };
  if (c === "AU" || c === "NZ")
    return { rule: "country", label, pass: published, note: published
      ? `${c === "AU" ? "Australia (Spam Act 2003)" : "New Zealand (Unsolicited Electronic Messages Act 2007)"}: inferred consent, because the company published the address and the message fits the role. Unsubscribe and sender ID included.`
      : `${c === "AU" ? "Australia (Spam Act 2003)" : "New Zealand (UEMA 2007)"}: cold email needs consent or an address the company published. Send it as a letter instead.` };
  if (c === "GB" || EU.has(c))
    return { rule: "country", label, pass: published, note: published ? `${c === "GB" ? "UK (PECR, UK GDPR)" : "EU (GDPR, ePrivacy)"}: a published corporate address, legitimate interest, opt-out in every message.` : "UK/EU: only a published corporate address may be emailed cold." };
  if (c === "MX")
    return { rule: "country", label, pass: published, note: "Mexico (LFPDPPP): a published business address with a clear opt-out." };
  return { rule: "country", label, pass: true, note: `${c === "US" ? "US (CAN-SPAM)" : c}: honest subject, sender identified, postal address and one-click opt-out in the footer.` };
}

// What the talent is said to DO. "Approved" is not here: the disclosure line says a person approved the message.
const ENDORSE = /\b(endorses?|endorsed|loves|is a (big |huge )?fan of|wears|uses|drinks|backs|recommends|has agreed|signed (on|with)|partner(s|ed)? with|is excited|would love to|can't wait)\b/i;
const AUDIENCE = /\b(fans?|audiences?|listeners?|followers?|viewers?|crowds?|people who)\b/i;

/** Every sentence that names the talent must be about their audience, and none may say the talent backs the brand. */
function endorsementRule(o: Outbound): Check {
  const label = RULE_LABEL.endorsement;
  for (const name of o.talent) {
    // The disclosure line names who the message is for; it isn't a claim about the talent.
    const sentences = `${o.subject}. ${o.body}`.split(/(?<=[.!?\n])\s+/).filter(s => s.toLowerCase().includes(name.toLowerCase()) && !/\bai agent\b/i.test(s));
    for (const s of sentences) {
      const rest = s.toLowerCase().split(name.toLowerCase()).slice(1).join(" ").slice(0, 80);
      if (ENDORSE.test(rest) && !AUDIENCE.test(rest.split(ENDORSE)[0] ?? ""))
        return { rule: "endorsement", label, pass: false, note: `"${s.trim().slice(0, 140)}" reads as ${name} backing the brand. Name the audience, not the person.` };
    }
  }
  return { rule: "endorsement", label, pass: true, note: o.talent.length ? `${o.talent.join(", ")} named only as audience data.` : "No talent named." };
}

/** Would the recipient's country rule let an email to an address from this source through? (Default rules.) */
export const emailAllowed = (country: string, source: "published" | "verified") =>
  countryRule({ channel: "email", subject: "", body: "", address: null, addressSource: source, country, talent: [], usesQloo: false }, DEFAULT_RULES).pass;

/** Does the brand compete in the category of one of the talent's exclusive deals? Flash-Lite judges the category. */
async function exclusivityRule(o: Outbound): Promise<Check> {
  const label = RULE_LABEL.exclusivity;
  const deals = (o.talentDeals ?? []).filter(d => d.exclusive || (d.year ?? 0) >= new Date().getFullYear() - 1);
  if (!o.targetBrand || !deals.length) return { rule: "exclusivity", label, pass: true, note: o.targetBrand ? "No current deals on record for the talent." : "No brand pitched." };
  const r = await ask("fast", `You check brand-deal conflicts. Given a talent's current brand deals and a new brand, say if the new brand SELLS
a directly competing product in the same category as a current deal (two sportswear makers, two beers, two phones, two fashion houses).
A sports club, league, venue, media company or retailer of many brands is NOT a competitor of a product brand. When unsure, no conflict. Reply JSON only:
{"conflict": true|false, "with": "brand or empty", "category": "shared category or empty"}`, JSON.stringify({ deals: deals.map(d => ({ brand: d.brand, category: d.category })), new_brand: o.targetBrand }), 120);
  const j = parseJson<{ conflict: boolean; with: string; category: string }>(r.text);
  if (j?.conflict) {
    const d = deals.find(x => x.brand.toLowerCase() === j.with?.toLowerCase());
    return { rule: "exclusivity", label, pass: false, note: `Conflicts with ${o.talent[0] ?? "the talent"}'s ${j.with} deal (${j.category})${d?.source ? `, source: ${d.source}` : ""}. Hold until the deal terms are checked.` };
  }
  return { rule: "exclusivity", label, pass: true, note: `${o.targetBrand} doesn't compete with ${deals.map(d => d.brand).join(", ")}.` };
}

export async function clear(o: Outbound, rules: Rules = DEFAULT_RULES): Promise<Clearance> {
  const opening = o.body.slice(0, 260).toLowerCase(), all = `${o.subject}\n${o.body}`.toLowerCase();
  const checks: Check[] = [];
  if (rules.disclosure) {
    const ok = /\bai\b|artificial intelligence/.test(opening);
    checks.push({ rule: "disclosure", label: RULE_LABEL.disclosure, pass: ok, note: ok ? "Says it was written by an AI agent in the first lines." : "The opening never says an AI agent wrote this." });
  }
  // Data honesty is not a setting: Qloo is credited when its numbers are used, and nothing poses as Qloo.
  const poses = /(we at qloo|i work (at|for) qloo|from qloo['’]s team|qloo team here|on behalf of qloo|our qloo)/.test(all);
  const credits = !o.usesQloo || /qloo/.test(all);
  checks.push({ rule: "data", label: "Data credited honestly", pass: !poses && credits && !/—/.test(all),
    note: poses ? "Reads as if sent by Qloo." : !credits ? "Uses Qloo numbers without crediting Qloo's taste data." : /—/.test(all) ? "House style: no em dashes." : o.usesQloo ? "Qloo's taste data credited; SYZYGY's own match score labelled as ours." : "Only SYZYGY's own match score is used, labelled as ours." });
  // Not a setting either: an audience is never described by violence, sexuality, religion, politics, health or age.
  const tastes = [...o.body.matchAll(/(shared (audience )?(tastes?|preferences?|interests?)|audiences? (share|like|love|lean)|tastes include|preferences? for|overlap in|interests? in)[^.]*\./gi)].map(m => m[0]).join(" ");
  const label = SENSITIVE.exec(tastes)?.[0];
  checks.push({ rule: "data", label: "No sensitive audience labels", pass: !label,
    note: label ? `Describes the audience with "${label}". Audiences are never described by violence, sexuality, religion, politics, health or age.` : "Audience described by tastes only." });
  if (rules.endorsement) checks.push(endorsementRule(o));
  if (rules.country) checks.push(countryRule(o, rules));
  if (rules.publishedOnly && o.channel === "email") {
    const ok = o.addressSource === "published" || o.addressSource === "verified";
    checks.push({ rule: "publishedOnly", label: RULE_LABEL.publishedOnly, pass: ok,
      note: o.addressSource === "verified" ? `${o.address} was found and verified as deliverable by Hunter; never guessed.`
        : ok ? `${o.address} appears on a page the company published.` : "The address wasn't found on a published page." });
  }
  if (rules.departed && o.roleStatus) {
    // "weak_source": the only page naming them is a gossip site or a lead database, which never confirms a role.
    const ok = o.roleStatus !== "departed" && o.roleStatus !== "weak_source";
    checks.push({ rule: "departed", label: o.roleStatus === "weak_source" ? "Named person confirmed on a page we trust" : RULE_LABEL.departed, pass: ok, note: ok ? "Still in the role as of the last check."
      : o.roleStatus === "weak_source" ? "The only page naming this person in the role is a gossip site or a lead database. Find a better source or drop the name." : "This person has left the role." });
  }
  if (rules.exclusivity) checks.push(await exclusivityRule(o));
  return { status: checks.every(c => c.pass) ? "pass" : "hold", checks, checkedAt: new Date().toISOString() };
}
