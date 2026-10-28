// The writer with no model (28 Oct: Google Cloud billing is off). It writes the note the way the drafts the models wrote
// for these desks read (permission_requests, draft_archive): who leans toward whom, the disclosure in the first lines, Qloo's
// both-ways score, one city, the offer from the lane's brief, and one question about the deal. Same rules as the model's
// drafts (style() in common.ts); a note that breaks one isn't filed.
type Brief = {
  kind?: string; sender?: string; recipient?: string; facts?: string[];
  recipient_person?: { name: string; role?: string }; delivered_via?: string;
};

const you = (s: string) => s.replace(/\bthey have\b/g, "you have").replace(/\bthey want\b/g, "you want")
  .replace(/\btheir\b/g, "your").replace(/\bthem\b/g, "you").replace(/\bthey\b/g, "you");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pick = <T,>(xs: T[], seed: string) => xs[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % xs.length];

/** The lane's closing ask ("Ask who runs talent partnerships.") as the question that ends the note. */
function question(kind: string, org: string) {
  const a = kind.match(/\bAsk (.+?)\.?\s*$/)?.[1]?.trim() ?? "";
  let m: RegExpMatchArray | null;
  if ((m = a.match(/^who (runs|handles) (.+)$/i))) return `Who ${m[1]} ${you(m[2])} for ${org}?`;
  if ((m = a.match(/^them to reply if (.+?) is open to it$/i))) return `Is ${m[1]} open to it?`;
  if ((m = a.match(/^them to reply if they want (.+)$/i))) return `Would you like ${you(m[1])}?`;
  if (/^them to reply with dates$/i.test(a)) return "Which dates could you hold?";
  if ((m = a.match(/^for (.+)$/i))) return `Could you reply with ${you(m[1]).replace(/^the /, "your ")}?`;
  if ((m = a.match(/^which (.+)$/i))) return `Which ${you(m[1]).replace(/you have$/, "do you have")}?`;
  return `Is this something ${org} would look at this season?`;
}

/** What the lane offers, from its brief ("...: a 12-month ambassador deal, built on..."). */
function offer(kind: string, org: string) {
  if (/Insights API/.test(kind)) return "a sample read of your audience from Qloo's Insights API, across music, film, TV, dining and travel";
  const body = kind.split(/:\s/).slice(1).join(": ");
  const o = body.split(/,? because |,? built on |\. Say why|\. Ask /)[0]?.trim().replace(/\.$/, "");
  if (!o || o.split(/\s+/).length > 30 || /^(which|who|what|when)\b/i.test(o)) return null;
  // "offer Instagram a presenting partnership" -> "a presenting partnership"
  return o.toLowerCase().startsWith(`offer ${org.toLowerCase()} `) ? o.slice(`offer ${org} `.length) : o.replace(/^offer /i, "");
}

export function houseDraft(brief: Brief): { subject: string; body: string } | null {
  const org = brief.recipient?.trim(), sender = brief.sender?.trim() || "our desk", kind = brief.kind ?? "", facts = brief.facts ?? [];
  if (!org) return null;
  const read = facts.map(f => f.match(/^Qloo's taste data, read today: (.+?) lean toward /)?.[1]).find(Boolean);
  const both = facts.map(f => f.match(/both ways[^:]*:\s*([\d.]+) out of 1/)?.[1]).find(Boolean);
  const city = facts.map(f => f.match(/^Both audiences concentrate in (.+?)\.$/)?.[1]).find(Boolean)?.split(/,| and /)[0]?.trim();
  const anchored = facts.some(f => /measured against those anchors/i.test(f));
  const person = brief.recipient_person?.name;

  const open = read ? `${cap(read)} lean toward ${org} in Qloo's taste data.` : `${org}'s audience sits close to ours in Qloo's taste data.`;
  const disclose = pick([
    `SYZYGY, an AI agent, drafted this note for ${sender} and a person on our team approved it.`,
    `SYZYGY, an AI agent, wrote this for ${sender}; a person on our team read and approved it.`,
  ], org);
  const score = both ? `Qloo's taste data scores the pair at ${both} out of 1, both ways${anchored ? ", measured against our audience anchors" : ""}.` : "";
  const where = city ? ` Both audiences concentrate in ${city}.` : "";
  const what = offer(kind, org);
  const ask = what ? `${pick(["We'd like to put forward", "What we have in mind is", "The idea is"], sender + org)} ${what}.` : "";
  const body = [
    ...(person ? [brief.delivered_via ? `For ${person}'s attention.` : `Hi ${person.split(" ")[0]},`] : []),
    `${open} ${disclose}`,
    `${score}${where}`.trim(),
    ask,
    question(kind, org),
    sender,
  ].filter(Boolean).join("\n\n");
  const short = `${org} and ${sender.replace(/'s? desk$/i, "").replace(/'s .*$/, "")}`;
  const subject = sender.split(/\s+/).length <= 3 && short.split(/\s+/).length <= 7 ? short : org.split(/\s+/).length <= 5 ? `A note for ${org}` : org;
  return { subject, body };
}
