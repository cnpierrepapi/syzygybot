// Letters: PostGrid print-mail for messages whose only route is paper. Same rule as email: a letter is created only after
// a person approved that one message ('queued'), and only if it still passes do-not-contact, Clearance and the footer at
// send time. The test key is used unless POSTGRID_LIVE=1: test letters are real API objects with a real address check and
// status, but nothing is printed. A live letter is printed and handed to USPS within two business days.
import { sql } from "./db";
import { logAction } from "./actions";
import { ask, parseJson } from "./llm";
import { clear } from "./clearance";
import { blocked, footer } from "./sequencer";
import { findInbox } from "./desks/common";

const API = "https://api.postgrid.com/print-mail/v1";

export const lettersLive = () => process.env.POSTGRID_LIVE === "1";

export const FROM = {
  companyName: "Onenept Studios Inc.", addressLine1: "611 South Dupont Highway", addressLine2: "Suite 102",
  city: "Dover", provinceOrState: "DE", postalOrZip: "19901", countryCode: "US",
};

export async function pg(path: string, init: { method?: string; body?: unknown; live: boolean }) {
  const key = init.live ? process.env.POSTGRID_LIVE_KEY : process.env.POSTGRID_API_KEY;
  if (!key) throw new Error(init.live ? "POSTGRID_LIVE_KEY not set" : "POSTGRID_API_KEY not set");
  if (!init.live && !key.startsWith("test_")) throw new Error("POSTGRID_API_KEY is not a test key");
  const r = await fetch(`${API}${path}`, {
    method: init.method ?? "GET", headers: { "x-api-key": key, "content-type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PostGrid ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 200)}`);
  return j as Record<string, any>;
}

export type Address = { addressLine1: string; addressLine2?: string; city: string; provinceOrState: string; postalOrZip: string; countryCode: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Free-text postal address → PostGrid fields. Every field must appear in the original, so nothing is made up. */
export async function parseAddress(text: string): Promise<Address | null> {
  const r = await ask("fast", `Split a postal address into fields. Copy text exactly from the input; never add or correct anything.
JSON only: {"addressLine1":"","addressLine2":"","city":"","provinceOrState":"","postalOrZip":"","countryCode":"ISO-2"}`, text, 200);
  const a = parseJson<Address>(r.text);
  if (!a?.addressLine1 || !a.city || !a.postalOrZip || !/^[A-Z]{2}$/.test(a.countryCode ?? "")) return null;
  const src = ` ${norm(text)} `;
  const fields = [a.addressLine1, a.addressLine2, a.city, a.postalOrZip, a.provinceOrState].filter((x): x is string => !!x);
  if (!fields.every(f => src.includes(` ${norm(f)} `))) return null;
  return a;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paras = (s: string) => s.trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

export function letterHtml(body: string, optoutToken: string, attention: string | null) {
  return `<html><body style="font-family: Georgia, serif; font-size: 11pt; line-height: 1.45; margin: 0.9in 1in;">
${attention ? `<p><b>For the attention of ${esc(attention)}</b></p>` : ""}${paras(body)}
<p style="margin-top: 28pt; font-size: 8.5pt; color: #444;">${esc(footer(optoutToken)).replace(/\n/g, "<br>")}</p></body></html>`;
}

type Row = {
  id: string; contact_id: string; channel: string; status: string; subject: string | null; body: string; optout_token: string | null; detail: Record<string, any>;
  contact_name: string | null; role: string; role_status: string; company: string; site: string | null;
};

async function load(touchId: string) {
  const [t] = (await sql()`
    select t.id, t.contact_id, t.channel, t.status, t.subject, t.body, t.optout_token, t.detail, c.name contact_name, c.role, c.role_status,
      e.name company, e.official_site site
    from touches t join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    where t.id = ${touchId}`) as Row[];
  return t ?? null;
}

/** The company's postal address: any we already found for it, else one search for its published contact details. */
async function postalFor(org: string, site: string | null) {
  const [hit] = (await sql()`select postal from org_contacts where org = ${org} and postal is not null order by checked_at desc limit 1`) as { postal: string }[];
  return hit?.postal ?? (await findInbox(org, site, "partnerships")).postal;
}

/** Approve one letter: the same checks as at send time, then 'queued'. */
export async function approveLetter(touchId: string, by: string) {
  const t = await load(touchId);
  if (!t) return { ok: false, why: "no such message" };
  if (t.channel !== "letter" || t.status !== "dry_run") return { ok: false, why: `this is a ${t.status} ${t.channel}` };
  await sql()`update touches set status = 'queued', detail = detail || ${JSON.stringify({ approved: { by, at: new Date().toISOString() } })}::jsonb where id = ${t.id}`;
  await logAction({ agent: "sequencer", kind: "touch.approved", summary: `A person approved the letter to ${t.company}. It goes to print-mail on the next run.`, refTable: "touches", refId: t.id });
  return { ok: true };
}

/** Creates the PostGrid letter for one approved letter touch. Test mode unless POSTGRID_LIVE=1. */
export async function sendLetter(touchId: string) {
  const t = await load(touchId);
  if (!t) return { ok: false, why: "no such message" };
  const live = lettersLive();
  const prior = t.detail?.postgrid as { id: string; live: boolean } | undefined;
  if (prior && (prior.live || !live)) return { ok: false, why: `letter ${prior.id} already exists` };
  const stop = async (why: string) => {
    await sql()`update touches set detail = detail || ${JSON.stringify({ letter_held: why })}::jsonb where id = ${t.id}`;
    await logAction({ agent: "sequencer", kind: "letter.held", summary: `Held the letter to ${t.company}: ${why}`, refTable: "touches", refId: t.id });
    return { ok: false, why };
  };
  if (t.channel !== "letter" || t.status !== "queued" || !t.detail?.approved) return { ok: false, why: "not an approved letter" };
  const dnc = await blocked(null, t.site);
  if (dnc) return stop(`${t.company} is on the do-not-contact list.`);
  if (t.role_status === "departed") return stop("the person has left the role.");
  if (!process.env.SYZYGY_POSTAL_ADDRESS?.trim() || !t.optout_token) return stop("the footer has no postal address or opt-out link yet.");
  const c = await clear({ channel: "letter", subject: t.subject ?? "", body: t.body, address: null, addressSource: null, roleStatus: t.role_status, country: "US", talent: [], usesQloo: /qloo/i.test(t.body) });
  if (c.status !== "pass") return stop(`Clearance holds it (${c.checks.filter(x => !x.pass).map(x => x.label.toLowerCase()).join(", ")}).`);
  const postal = await postalFor(t.company, t.site);
  const to = postal ? await parseAddress(postal) : null;
  if (!to) return stop(postal ? "the postal address couldn't be read field by field." : "no published postal address was found.");
  const attention = t.detail?.attention ?? t.contact_name ?? null;
  const [first, ...rest] = (attention ?? "").split(" ");
  try {
    const l = await pg("/letters", { method: "POST", live, body: {
      to: { ...to, companyName: t.company, ...(attention ? { firstName: first, lastName: rest.join(" "), jobTitle: t.role } : {}) },
      from: FROM, html: letterHtml(t.body, t.optout_token, attention), addressPlacement: "insert_blank_page",
      color: false, doubleSided: false, mailingClass: "first_class", description: `SYZYGY ${t.company}`.slice(0, 60), metadata: { touch: t.id },
    } });
    const rec = { id: l.id, live, status: l.status, to_status: l.to?.addressStatus ?? null, at: new Date().toISOString() };
    await sql()`update touches set detail = detail || ${JSON.stringify({ postgrid: rec })}::jsonb where id = ${t.id}`;
    if (live) await sql()`update touches set status = 'sent', sent_at = now() where id = ${t.id}`;
    await logAction({
      agent: "sequencer", kind: live ? "letter.sent" : "letter.test",
      summary: live ? `Sent the letter to ${t.company} to print. PostGrid prints it and hands it to USPS within two business days.`
        : `Created the letter to ${t.company} in PostGrid test mode: address checked (${rec.to_status ?? "unknown"}), nothing printed.`,
      refTable: "touches", refId: t.id, detail: { postgrid: rec },
    });
    return { ok: true, live, letter: rec };
  } catch (e) {
    return stop(`print-mail refused it (${(e as Error).message.slice(0, 120)}).`);
  }
}

/** Approved letters not yet created. Run by the mail cron. */
export async function sendDueLetters(limit = 3) {
  const due = (await sql()`select id from touches where channel = 'letter' and status = 'queued' and detail->'postgrid' is null
    and detail->'letter_held' is null order by created_at limit ${limit}`) as { id: string }[];
  const out = [];
  for (const d of due) out.push({ touch: d.id, ...(await sendLetter(d.id)) });
  return out;
}

/** Status changes of letters already created (printed, mailed, IMb scans), onto the floor. */
export async function pollLetters() {
  const rows = (await sql()`select id, detail->'postgrid' pg, (select e.name from contacts c join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id where c.id = t.contact_id) company
    from touches t where detail->'postgrid' is not null and coalesce(detail->'postgrid'->>'status', '') not in ('completed','cancelled')`) as
    { id: string; pg: { id: string; live: boolean; status: string; imb?: string | null }; company: string }[];
  const out = [];
  for (const r of rows) {
    try {
      const l = await pg(`/letters/${r.pg.id}`, { live: r.pg.live });
      const imb = l.imbStatus ?? null, tracking = l.trackingNumber ?? null;
      if (l.status === r.pg.status && imb === (r.pg.imb ?? null)) continue;
      const rec = { ...r.pg, status: l.status, imb, tracking, checked: new Date().toISOString() };
      await sql()`update touches set detail = detail || ${JSON.stringify({ postgrid: rec })}::jsonb where id = ${r.id}`;
      await logAction({ agent: "sequencer", kind: "letter.status", summary: `The letter to ${r.company}${r.pg.live ? "" : " (test mode)"} is now ${String(l.status).replace(/_/g, " ")}${imb ? `, USPS: ${imb}` : ""}.`, refTable: "touches", refId: r.id, detail: { postgrid: rec } });
      out.push({ touch: r.id, status: l.status });
    } catch { /* next run */ }
  }
  return out;
}
