// Mail: the Sequencer's sender. A drafted email only leaves when a person approved that one message (status 'queued'),
// it still passes every gate at send time, and MAIL_LIVE=1 is set. Without MAIL_LIVE it renders the exact message and logs
// it as a dry run, once. Gates: do-not-contact, a person still in the role, Clearance, the postal footer, the recipient's
// sending window, the daily cap and one message per company per day, and the earlier step already sent.
import nodemailer, { type Transporter } from "nodemailer";
import { sql } from "./db";
import { logAction } from "./actions";
import { clear, countryOf } from "./clearance";
import { blocked, footer, inWindow, local } from "./sequencer";
import { SITE } from "./slug";

export const SEND_CAP = 5; // real emails a day, across every company
const DOMAIN = "syzygybot.com";

export const mailLive = () => process.env.MAIL_LIVE === "1";
export const fromAddress = () => process.env.ZOHO_MAIL_USER ?? `agent@${DOMAIN}`;
export const messageIdOf = (touchId: string) => `<${touchId}@${DOMAIN}>`;

let tx: Transporter | null = null;
export function transport() {
  if (!tx) {
    const user = process.env.ZOHO_MAIL_USER, pass = process.env.ZOHO_APP_PASSWORD;
    if (!user || !pass) throw new Error("ZOHO_MAIL_USER / ZOHO_APP_PASSWORD not set");
    tx = nodemailer.createTransport({ host: process.env.ZOHO_SMTP_HOST ?? "smtp.zoho.eu", port: 465, secure: true, auth: { user, pass } });
  }
  return tx;
}

type Row = {
  id: string; contact_id: string; channel: string; step: number; subject: string | null; body: string; status: string;
  to_address: string | null; optout_token: string | null; detail: Record<string, any>; scheduled_for: string | null;
  contact_name: string | null; role_status: string; verification: Record<string, any>; entity_id: string; company: string; site: string | null; tz: string | null;
};

async function load(touchId: string) {
  const [t] = (await sql()`
    select t.id, t.contact_id, t.channel, t.step, t.subject, t.body, t.status, t.to_address, t.optout_token, t.detail, t.scheduled_for,
      c.name contact_name, c.role_status, c.verification, ac.entity_id, e.name company, e.official_site site, ac.tz
    from touches t join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    where t.id = ${touchId}`) as Row[];
  return t ?? null;
}

export type Gate = { gate: string; pass: boolean; note: string };

/** Everything that must be true for this message to leave now. `timing` off skips the window, cap and order (for approval). */
export async function gates(t: Row, timing = true): Promise<Gate[]> {
  const g: Gate[] = [];
  const push = (gate: string, pass: boolean, note: string) => g.push({ gate, pass, note });
  push("channel", t.channel === "email" && !!t.to_address, t.to_address ? "Email with an address." : "No email address on this message.");
  push("status", ["dry_run", "queued"].includes(t.status), t.status === "dry_run" ? "Drafted, not sent yet." : t.status === "queued" ? "Approved, waiting to send." : `This message is ${t.status}.`);
  const dnc = await blocked(t.to_address, t.site);
  push("do_not_contact", !dnc, dnc ? `On the do-not-contact list: ${dnc.reason}.` : "Not on the do-not-contact list.");
  push("in_role", t.role_status !== "departed", t.role_status === "departed" ? "This person has left the role." : "Still in the role as of the last check.");
  push("postal_footer", !!process.env.SYZYGY_POSTAL_ADDRESS?.trim() && !!t.optout_token, "Footer carries the opt-out link and a postal address.");
  const c = await clear({
    channel: "email", subject: t.subject ?? "", body: t.body, address: t.to_address,
    addressSource: t.verification?.address_source === "hunter" ? "verified" : "published", roleStatus: t.role_status,
    country: countryOf(t.to_address, "US"), talent: [], usesQloo: /qloo/i.test(t.body),
  });
  const held = c.checks.filter(x => !x.pass);
  push("clearance", c.status === "pass", held.length ? `Clearance holds it: ${held.map(x => x.note).join(" ")}` : `Clearance passed ${c.checks.length} rules.`);
  if (!timing) return g;
  const tz = t.detail?.tz ?? t.tz ?? "America/New_York", now = new Date();
  push("window", inWindow(now, tz), `Sending window is Tue to Thu, 09:00 to 11:30 in ${tz}; it is ${local(now, tz).weekday} ${String(Math.floor(local(now, tz).minutes / 60)).padStart(2, "0")}:${String(local(now, tz).minutes % 60).padStart(2, "0")} there.`);
  const [{ today, company }] = (await sql()`
    select count(*)::int today, count(*) filter (where ac.entity_id = ${t.entity_id})::int company
    from touches x join contacts c on c.id = x.contact_id join accounts ac on ac.id = c.account_id
    where x.status = 'sent' and x.channel = 'email' and x.sent_at > now() - interval '24 hours'`) as { today: number; company: number }[];
  push("daily_cap", today < SEND_CAP, `${today} of ${SEND_CAP} emails sent in the last 24 hours.`);
  push("one_per_company", company === 0, company ? `${t.company} already got an email in the last 24 hours.` : `First email to ${t.company} today.`);
  if (t.step > 1) {
    const [prev] = (await sql()`select status from touches where contact_id = ${t.contact_id} and step = ${t.step - 1} and channel = 'email'`) as { status: string }[];
    push("order", prev?.status === "sent", prev?.status === "sent" ? `Step ${t.step - 1} went out first.` : `Step ${t.step - 1} hasn't been sent, so this follow-up waits.`);
  }
  return g;
}

/** The exact message that would leave: body, footer, threading and opt-out headers. */
export async function render(t: Row) {
  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${SITE}/optout/${t.optout_token}>, <mailto:${fromAddress()}?subject=unsubscribe>`,
  };
  let inReplyTo: string | undefined;
  if (t.step > 1) {
    const [first] = (await sql()`select message_id from touches where contact_id = ${t.contact_id} and step = 1 and channel = 'email'`) as { message_id: string | null }[];
    inReplyTo = first?.message_id ?? undefined;
  }
  return {
    from: `"Syzygy (AI agent)" <${fromAddress()}>`, to: t.to_address!, subject: t.subject ?? "",
    text: `${t.body.trim()}\n\n${footer(t.optout_token!)}`, messageId: messageIdOf(t.id), headers,
    ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
  };
}

const who = (t: Row) => t.contact_name ?? `the ${t.company} inbox`;

/** His go for one message: re-checks every gate except timing, then marks it queued for the next window. */
export async function approve(touchId: string, by: string) {
  const t = await load(touchId);
  if (!t) return { ok: false, why: "no such message" };
  const g = (await gates(t, false)).filter(x => !x.pass);
  if (g.length) return { ok: false, why: g.map(x => x.note).join(" ") };
  await sql()`update touches set status = 'queued', detail = detail || ${JSON.stringify({ approved: { by, at: new Date().toISOString() } })}::jsonb where id = ${t.id}`;
  await logAction({ agent: "sequencer", kind: "touch.approved", summary: `A person approved the ${t.channel} to ${who(t)} at ${t.company}. It goes out in the next sending window.`, refTable: "touches", refId: t.id });
  return { ok: true };
}

/** Sends one approved email if every gate passes. Without MAIL_LIVE=1 it logs the rendered message as a dry run instead. */
export async function sendEmail(touchId: string, opts: { live?: boolean } = {}) {
  const t = await load(touchId);
  if (!t) return { ok: false, why: "no such message" };
  const g = await gates(t);
  const approved = t.status === "queued" && !!t.detail?.approved;
  if (!approved) g.push({ gate: "approved", pass: false, note: "No person has approved this message." });
  const failed = g.filter(x => !x.pass);
  const live = (opts.live ?? true) && mailLive();
  if (failed.length || !live) {
    const msg = failed.length ? null : await render(t);
    if (!failed.length && !t.detail?.dry_run_logged) {
      await sql()`update touches set detail = detail || ${JSON.stringify({ dry_run_logged: new Date().toISOString(), rendered: msg })}::jsonb where id = ${t.id}`;
      await logAction({ agent: "sequencer", kind: "touch.dry_run", summary: `The email to ${who(t)} at ${t.company} passed every gate. Sending is switched off, so it was rendered and logged, not sent.`, refTable: "touches", refId: t.id });
    }
    return { ok: false, live, gates: g, rendered: msg };
  }
  const msg = await render(t);
  try {
    const info = await transport().sendMail(msg);
    await sql()`update touches set status = 'sent', sent_at = now(), message_id = ${msg.messageId},
      detail = detail || ${JSON.stringify({ smtp: { response: info.response?.slice(0, 120), accepted: info.accepted?.length ?? 0 } })}::jsonb where id = ${t.id}`;
    await logAction({ agent: "sequencer", kind: "touch.sent", summary: `Sent step ${t.step} to ${who(t)} at ${t.company}, approved by a person. Stops on any reply or opt-out.`, refTable: "touches", refId: t.id });
    return { ok: true, live, gates: g };
  } catch (e) {
    const why = (e as Error).message.slice(0, 200);
    await sql()`update touches set status = 'failed', detail = detail || ${JSON.stringify({ smtp_error: why })}::jsonb where id = ${t.id}`;
    await logAction({ agent: "sequencer", kind: "touch.failed", summary: `The email to ${who(t)} at ${t.company} failed at the mail server; nothing was retried.`, refTable: "touches", refId: t.id, detail: { error: why } });
    return { ok: false, live, why };
  }
}

/** Approved emails whose time has come. Run by the mail cron. */
export async function sendDueEmails(limit = SEND_CAP) {
  const due = (await sql()`select id from touches where channel = 'email' and status = 'queued'
    and (scheduled_for is null or scheduled_for <= now()) order by step, scheduled_for nulls first limit ${limit}`) as { id: string }[];
  const out = [];
  for (const d of due) { const r = await sendEmail(d.id); out.push({ touch: d.id, sent: r.ok, held: r.gates?.filter(x => !x.pass).map(x => x.gate) }); }
  return out;
}

/** A plain note to one of our own people (handoffs). Never goes to a prospect. */
export async function notifyPerson(to: string, subject: string, text: string) {
  const info = await transport().sendMail({ from: `"SYZYGY" <${fromAddress()}>`, to, subject, text });
  return info.accepted?.length ? "sent" : `refused: ${info.response?.slice(0, 80)}`;
}

/** The gates as they stand right now, for the operator's panel. */
export async function preflight(touchId: string) {
  const t = await load(touchId);
  return t ? gates(t) : [];
}

/** The operator's one tap: approve this message, then send it now if every gate passes (else it waits for its window). */
export async function approveAndSend(touchId: string) {
  const t = await load(touchId);
  if (!t) return { ok: false, why: "no such message" };
  if (t.status === "dry_run") {
    const a = await approve(touchId, "operator");
    if (!a.ok) return a;
  }
  const r = await sendEmail(touchId);
  if (r.ok) return { ok: true, why: "sent" };
  const held = r.gates?.filter(g => !g.pass) ?? [];
  return { ok: false, why: held.length ? held.map(g => g.note).join(" ") : !r.live ? "Approved. Sending is switched off (MAIL_LIVE), so it was logged, not sent." : r.why ?? "not sent" };
}
