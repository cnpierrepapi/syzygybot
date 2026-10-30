// Real sends from live-run cards (24 Oct). On a desk its owner verified (lib/owners.ts), approving a card sends that card's
// message as written, in the desk's name: the exact text on the card, or the owner's edit of it. It goes out through the
// same gates as every message: do-not-contact, the person still in the role, Clearance under the full default rules, the
// postal footer and opt-out link, for email the recipient's sending window, the daily cap and one email per company a
// day, and for letters a daily cap on print-mail spend. Email needs MAIL_LIVE=1; letters print only with POSTGRID_LIVE=1.
import { sql } from "./db";
import { logAction } from "./actions";
import { ask, geminiOn, parseJson } from "./llm";
import { ruleReply } from "./replyrules";
import { clear } from "./clearance";
import { blocked, footer, inWindow, local } from "./sequencer";
import { fromAddress, mailLive, nextWindow, SEND_CAP, transport } from "./mail";
import { FROM, letterHtml, lettersLive, parseAddress, pg } from "./letters";
import { talentDeals } from "./desks/common";
import { CLASSES, CLASSIFY_SYSTEM } from "./inbox";
import { SITE, token } from "./slug";

const DOMAIN = "syzygybot.com";
export const outboundMessageId = (id: string) => `<${id}@${DOMAIN}>`;

const TZ: Record<string, string> = { US: "America/New_York", CA: "America/Toronto", GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris",
  DE: "Europe/Berlin", ES: "Europe/Madrid", IT: "Europe/Rome", NL: "Europe/Amsterdam", MX: "America/Mexico_City", BR: "America/Sao_Paulo",
  AU: "Australia/Sydney", JP: "Asia/Tokyo", PR: "America/Puerto_Rico" };

type Req = { id: string; persona: string; title: string; run_id: string | null; target: Record<string, any> };
export type Outbound = {
  id: string; request_id: string; channel: "email" | "letter"; company: string; site: string | null; to_address: string | null;
  postal: string | null; attention: string | null; role: string | null; role_status: string | null; country: string; tz: string;
  subject: string | null; body: string; status: string; scheduled_for: string | null; sent_at: string | null; optout_token: string;
  detail: Record<string, any>; created_at: string;
};

export const LETTER_CAP = 10;  // real letters a day across every desk: each one is printed and posted at our cost

export async function outboundFor(requestIds: string[]) {
  if (!requestIds.length) return new Map<string, Outbound>();
  const rows = (await sql()`select * from outbound where request_id = any(${requestIds}::uuid[])`) as Outbound[];
  return new Map(rows.map(o => [o.request_id, o]));
}

/** What this desk has approved for real: waiting for a window first, then the latest sent. */
export async function queueFor(personaId: string) {
  return (await sql()`select o.* from outbound o join permission_requests r on r.id = o.request_id
    where r.persona = ${personaId} and o.status in ('queued', 'sent')
    order by o.status = 'sent', o.scheduled_for nulls first, o.sent_at desc limit 20`) as Outbound[];
}

/** The card's message, exactly as it will leave, staged for sending. A message already queued or sent is left alone. */
async function stage(requestId: string, msg: { subject: string; body: string }, by: string) {
  const [r] = (await sql()`select id, persona, title, run_id, target from permission_requests where id = ${requestId}`) as Req[];
  if (!r) return { ok: false as const, why: "That card is gone." };
  const t = r.target;
  if (t.channel === "email" && !t.address) return { ok: false as const, why: "There's no published address to send this to." };
  if (t.channel === "letter" && !t.postal) return { ok: false as const, why: "There's no published postal address for this one." };
  const [cur] = (await sql()`select status from outbound where request_id = ${requestId}`) as { status: string }[];
  if (cur && !["draft", "held", "cancelled"].includes(cur.status)) return { ok: false as const, why: `It's already ${cur.status}.` };
  const country = String(t.country ?? "US").toUpperCase();
  await sql()`insert into outbound (request_id, channel, company, site, to_address, postal, attention, role, role_status, country, tz, subject, body, status, optout_token, detail)
    values (${requestId}, ${t.channel}, ${t.org}, ${t.site ?? null}, ${t.address ?? null}, ${t.postal ?? null}, ${t.person ?? null}, ${t.role ?? null}, ${t.roleStatus ?? null},
      ${country}, ${TZ[country] ?? "America/New_York"}, ${msg.subject}, ${msg.body.trim()}, 'draft', ${token(10)}, ${JSON.stringify({ staged: { by, at: new Date().toISOString() } })})
    on conflict (request_id) do update set subject = excluded.subject, body = excluded.body, status = 'draft', scheduled_for = null,
      detail = outbound.detail || excluded.detail`;
  return { ok: true as const };
}

type Gate = { gate: string; pass: boolean; note: string };

async function gates(o: Outbound, timing: boolean): Promise<Gate[]> {
  const g: Gate[] = [];
  const push = (gate: string, pass: boolean, note: string) => g.push({ gate, pass, note });
  const [r] = (await sql()`select target from permission_requests where id = ${o.request_id}`) as { target: Record<string, any> }[];
  const t = r?.target ?? {};
  push("route", o.channel === "email" ? !!o.to_address : !!o.postal, o.channel === "email" ? (o.to_address ? "Email with a published address." : "No email address.") : (o.postal ? "Letter with a published postal address." : "No postal address."));
  const dnc = await blocked(o.to_address, o.site);
  push("do_not_contact", !dnc, dnc ? `On the do-not-contact list: ${dnc.reason}.` : "Not on the do-not-contact list.");
  push("in_role", o.role_status !== "departed", o.role_status === "departed" ? "This person has left the role." : "No sign they've left the role.");
  push("postal_footer", !!process.env.SYZYGY_POSTAL_ADDRESS?.trim(), "Footer carries the opt-out link and a postal address.");
  const talent: string[] = t.talent ?? [];
  const deals = talent[0] && t.brand ? await talentDeals(talent[0]).catch(() => []) : [];
  const c = await clear({ channel: o.channel, subject: o.subject ?? "", body: o.body, address: o.to_address, addressSource: o.to_address ? "published" : null,
    roleStatus: o.role_status, country: o.country, talent, targetBrand: t.brand ?? null, talentDeals: deals, usesQloo: true });
  const held = c.checks.filter(x => !x.pass);
  push("clearance", c.status === "pass", held.length ? `Clearance holds it: ${held.map(x => x.note).join(" ")}` : `Clearance passed all ${c.checks.length} rules.`);
  if (o.channel === "letter") {
    const [{ n }] = (await sql()`select count(*)::int n from outbound where channel = 'letter' and status = 'sent' and sent_at > now() - interval '24 hours'`) as { n: number }[];
    push("letter_cap", n < LETTER_CAP, `${n} of ${LETTER_CAP} letters printed in the last 24 hours.`);
  }
  if (!timing || o.channel !== "email") return g;
  const now = new Date(), l = local(now, o.tz);
  push("window", inWindow(now, o.tz), `Sending window is Tue to Thu, 09:00 to 11:30 in ${o.tz}; it is ${l.weekday} ${String(Math.floor(l.minutes / 60)).padStart(2, "0")}:${String(l.minutes % 60).padStart(2, "0")} there.`);
  const [{ today, company }] = (await sql()`select
      (select count(*) from touches where status = 'sent' and channel = 'email' and sent_at > now() - interval '24 hours')::int
        + (select count(*) from outbound where status = 'sent' and channel = 'email' and sent_at > now() - interval '24 hours')::int today,
      (select count(*) from outbound where status = 'sent' and channel = 'email' and sent_at > now() - interval '24 hours' and lower(company) = lower(${o.company}))::int company`) as { today: number; company: number }[];
  push("daily_cap", today < SEND_CAP, `${today} of ${SEND_CAP} emails sent in the last 24 hours.`);
  push("one_per_company", company === 0, company ? `${o.company} already got an email in the last 24 hours.` : `First email to ${o.company} today.`);
  return g;
}

const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

/** The owner's go on the card's exact text: every gate but timing now, then queued; sent at once if it's due. */
export async function approveReal(requestId: string, msg: { subject: string; body: string }, by: string) {
  const st = await stage(requestId, msg, by);
  if (!st.ok) return st;
  const [o] = (await sql()`select * from outbound where request_id = ${requestId}`) as Outbound[];
  const failed = (await gates(o, false)).filter(x => !x.pass);
  if (failed.length) {
    await sql()`update outbound set status = 'held', detail = detail || ${JSON.stringify({ held: failed })}::jsonb where id = ${o.id}`;
    return { ok: false as const, why: failed.map(x => x.note).join(" ") };
  }
  const at = o.channel === "email" ? nextWindow(o.tz) : new Date();
  await sql()`update outbound set status = 'queued', scheduled_for = ${at.toISOString()},
    detail = detail || ${JSON.stringify({ approved: { by, at: new Date().toISOString() } })}::jsonb where id = ${o.id}`;
  const due = +at - Date.now() < 60_000;
  const sent = due ? await sendOne(o.id) : null;
  const [after] = (await sql()`select status, detail from outbound where id = ${o.id}`) as { status: string; detail: Record<string, any> }[];
  const did = after.status === "sent"
    ? o.channel === "email" ? `Sent to ${o.company}${o.attention ? ` for ${o.attention}` : ""}. A real email, now in their inbox.` : `The letter to ${o.company} went to print. PostGrid posts it within two business days.`
    : after.status === "queued"
      ? o.channel === "email" ? `Approved for real. It sends ${fmt(at, o.tz)} their time, when their sending window opens.` : `Approved for real. The letter goes to print on the next mail run.`
      : `Approved, but it didn't go: ${sent?.why ?? after.detail?.held?.[0]?.note ?? after.status}.`;
  await logAction({ agent: "sequencer", kind: "outbound.approved", summary: `The desk's owner approved the real ${o.channel} to ${o.company}. ${did}`, refTable: "permission_requests", refId: requestId, detail: { outbound: o.id } });
  return { ok: true as const, did, status: after.status };
}

/** Taking a real approval back before it went out. */
export async function cancelReal(requestId: string) {
  const rows = (await sql()`update outbound set status = 'draft', scheduled_for = null, detail = detail - 'approved'
    where request_id = ${requestId} and status = 'queued' returning id`) as { id: string }[];
  return rows.length > 0;
}

/** Sends one queued message if every gate passes now. Email without MAIL_LIVE=1 is logged as a dry run, once. */
export async function sendOne(id: string): Promise<{ ok: boolean; why?: string }> {
  const [o] = (await sql()`select * from outbound where id = ${id}`) as Outbound[];
  if (!o || o.status !== "queued" || !o.detail?.approved) return { ok: false, why: "not an approved message" };
  const [r] = (await sql()`select persona, run_id from permission_requests where id = ${o.request_id}`) as { persona: string; run_id: string | null }[];
  const where = { persona: r?.persona, ...(r?.run_id ? { run: r.run_id } : {}), outbound: o.id };
  const failed = (await gates(o, true)).filter(x => !x.pass);
  // Outside the window or over the cap: wait for the next run. Anything else holds it for a person.
  const waiting = failed.filter(x => ["window", "daily_cap", "one_per_company", "letter_cap"].includes(x.gate));
  if (failed.length > waiting.length) {
    const why = failed.filter(x => !waiting.includes(x)).map(x => x.note).join(" ");
    await sql()`update outbound set status = 'held', detail = detail || ${JSON.stringify({ held: failed })}::jsonb where id = ${o.id}`;
    await logAction({ agent: "sequencer", kind: "outbound.held", summary: `Held the ${o.channel} to ${o.company} at send time: ${why}`, refTable: "permission_requests", refId: o.request_id, detail: where });
    return { ok: false, why };
  }
  if (waiting.length) return { ok: false, why: waiting.map(x => x.note).join(" ") };
  const text = `${o.body.trim()}\n\n${footer(o.optout_token)}`;
  if (o.channel === "email") {
    if (!mailLive()) {
      if (!o.detail?.dry_run_logged) {
        await sql()`update outbound set detail = detail || ${JSON.stringify({ dry_run_logged: new Date().toISOString() })}::jsonb where id = ${o.id}`;
        await logAction({ agent: "sequencer", kind: "outbound.dry_run", summary: `The email to ${o.company} passed every gate. Sending is switched off, so it was logged, not sent.`, refTable: "permission_requests", refId: o.request_id, detail: where });
      }
      return { ok: false, why: "Sending is switched off (MAIL_LIVE)." };
    }
    const msg = {
      from: `"Syzygy (AI agent)" <${fromAddress()}>`, to: o.to_address!, subject: o.subject ?? "", text, messageId: outboundMessageId(o.id),
      headers: { "List-Unsubscribe": `<${SITE}/optout/${o.optout_token}>, <mailto:${fromAddress()}?subject=unsubscribe>` },
    };
    try {
      const info = await transport().sendMail(msg);
      await sql()`update outbound set status = 'sent', sent_at = now(), message_id = ${msg.messageId},
        detail = detail || ${JSON.stringify({ smtp: { response: info.response?.slice(0, 120), accepted: info.accepted?.length ?? 0 } })}::jsonb where id = ${o.id}`;
      await logAction({ agent: "sequencer", kind: "outbound.sent", summary: `Sent the email to ${o.attention ? `${o.attention} at ` : ""}${o.company}, approved by the desk's owner.`, refTable: "permission_requests", refId: o.request_id, detail: where });
      return { ok: true };
    } catch (e) {
      const why = (e as Error).message.slice(0, 200);
      await sql()`update outbound set status = 'failed', detail = detail || ${JSON.stringify({ smtp_error: why })}::jsonb where id = ${o.id}`;
      await logAction({ agent: "sequencer", kind: "outbound.failed", summary: `The email to ${o.company} failed at the mail server; nothing was retried.`, refTable: "permission_requests", refId: o.request_id, detail: { ...where, error: why } });
      return { ok: false, why };
    }
  }
  // Letter.
  const live = lettersLive();
  const to = o.postal ? await parseAddress(o.postal) : null;
  if (!to) {
    await sql()`update outbound set status = 'held', detail = detail || ${JSON.stringify({ held: [{ gate: "postal", pass: false, note: "the postal address couldn't be read field by field" }] })}::jsonb where id = ${o.id}`;
    await logAction({ agent: "sequencer", kind: "outbound.held", summary: `Held the letter to ${o.company}: its postal address couldn't be read field by field.`, refTable: "permission_requests", refId: o.request_id, detail: where });
    return { ok: false, why: "the postal address couldn't be read field by field" };
  }
  const [first, ...rest] = (o.attention ?? "").split(" ");
  try {
    const l = await pg("/letters", { method: "POST", live, body: {
      to: { ...to, companyName: o.company, ...(o.attention ? { firstName: first, lastName: rest.join(" "), ...(o.role ? { jobTitle: o.role } : {}) } : {}) },
      from: FROM, html: letterHtml(o.body, o.optout_token, o.attention), addressPlacement: "insert_blank_page",
      color: false, doubleSided: false, mailingClass: "first_class", description: `SYZYGY ${o.company}`.slice(0, 60), metadata: { outbound: o.id },
    } });
    const rec = { id: l.id, live, status: l.status, to_status: l.to?.addressStatus ?? null, at: new Date().toISOString() };
    await sql()`update outbound set status = ${live ? "sent" : "queued"}, sent_at = ${live ? new Date().toISOString() : null},
      detail = detail || ${JSON.stringify({ postgrid: rec })}::jsonb where id = ${o.id}`;
    await logAction({ agent: "sequencer", kind: live ? "outbound.sent" : "outbound.test",
      summary: live ? `Sent the letter to ${o.company} to print. PostGrid prints it and hands it to USPS within two business days.`
        : `Created the letter to ${o.company} in PostGrid test mode: address checked (${rec.to_status ?? "unknown"}), nothing printed.`,
      refTable: "permission_requests", refId: o.request_id, detail: { ...where, postgrid: rec } });
    return { ok: live };
  } catch (e) {
    const why = `print-mail refused it (${(e as Error).message.slice(0, 160)})`;
    await sql()`update outbound set status = 'held', detail = detail || ${JSON.stringify({ held: [{ gate: "postgrid", pass: false, note: why }] })}::jsonb where id = ${o.id}`;
    await logAction({ agent: "sequencer", kind: "outbound.held", summary: `Held the letter to ${o.company}: ${why}.`, refTable: "permission_requests", refId: o.request_id, detail: where });
    return { ok: false, why };
  }
}

/** Approved messages whose time has come. Run by the mail cron. */
export async function sendDueOutbound(limit = SEND_CAP) {
  const due = (await sql()`select id from outbound where status = 'queued' and detail->'postgrid' is null
    and (scheduled_for is null or scheduled_for <= now()) order by scheduled_for nulls first limit ${limit}`) as { id: string }[];
  const out = [];
  for (const d of due) out.push({ outbound: d.id, ...(await sendOne(d.id)) });
  return out;
}

/** Status changes of live letters already created (printed, mailed, USPS scans). */
export async function pollOutboundLetters() {
  const rows = (await sql()`select id, request_id, company, detail->'postgrid' pg from outbound
    where detail->'postgrid' is not null and (detail->'postgrid'->>'live')::boolean and coalesce(detail->'postgrid'->>'status', '') not in ('completed','cancelled')`) as
    { id: string; request_id: string; company: string; pg: { id: string; live: boolean; status: string; imb?: string | null } }[];
  const out = [];
  for (const r of rows) {
    try {
      const l = await pg(`/letters/${r.pg.id}`, { live: true });
      const imb = l.imbStatus ?? null;
      if (l.status === r.pg.status && imb === (r.pg.imb ?? null)) continue;
      const rec = { ...r.pg, status: l.status, imb, tracking: l.trackingNumber ?? null, checked: new Date().toISOString() };
      await sql()`update outbound set detail = detail || ${JSON.stringify({ postgrid: rec })}::jsonb where id = ${r.id}`;
      await logAction({ agent: "sequencer", kind: "outbound.letter_status", summary: `The letter to ${r.company} is now ${String(l.status).replace(/_/g, " ")}${imb ? `, USPS: ${imb}` : ""}.`, refTable: "permission_requests", refId: r.request_id, detail: { outbound: r.id } });
      out.push({ outbound: r.id, status: l.status });
    } catch { /* next run */ }
  }
  return out;
}

/** Cancels anything unsent to an address or a company's site (an opt-out). */
export async function stopOutbound(address: string | null, company: string | null) {
  const rows = (await sql()`update outbound set status = 'cancelled', detail = detail || '{"cancelled": "opted out"}'::jsonb
    where status in ('draft','queued','held') and ((${address}::text is not null and lower(to_address) = lower(${address}))
      or (${company}::text is not null and lower(company) = lower(${company}))) returning id`) as { id: string }[];
  return rows.length;
}

/** A reply to one of these: sorted by the Inbox agent; opt-outs honoured; anything a person should see goes to them. */
export async function handleOutboundReply(o: Outbound, text: string, meta: Record<string, unknown>) {
  const c = geminiOn() ? await ask("fast", CLASSIFY_SYSTEM, JSON.stringify({ our_message: o.body, their_reply: text }), 400) : ruleReply(text);
  const parsed = parseJson<{ class: string; summary?: string }>(c.text);
  const cls = parsed && (CLASSES as readonly string[]).includes(parsed.class) ? parsed.class : "other";
  const [reply] = (await sql()`insert into outbound_replies (outbound_id, class, body, summary, detail)
    values (${o.id}, ${cls}, ${text}, ${parsed?.summary ?? null}, ${JSON.stringify(meta)}) returning id`) as { id: string }[];
  const [r] = (await sql()`select persona, run_id from permission_requests where id = ${o.request_id}`) as { persona: string; run_id: string | null }[];
  const where = { persona: r?.persona, ...(r?.run_id ? { run: r.run_id } : {}), outbound: o.id };
  const who = o.attention ?? `${o.company}'s inbox`;
  if (cls === "opt_out") {
    const value = (o.to_address ?? o.site?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? o.company).toLowerCase();
    await sql()`insert into do_not_contact (value, reason) values (${value}, ${"asked to stop in a reply"}) on conflict (value) do nothing`;
    const n = await stopOutbound(o.to_address, o.company);
    await logAction({ agent: "inbox", kind: "optout.honoured", summary: `${who} at ${o.company} asked to stop. Added to do-not-contact; ${n} unsent cancelled. No reply sent.`, refTable: "permission_requests", refId: o.request_id, detail: where });
  } else {
    await logAction({ agent: "inbox", kind: `reply.${cls}`, summary: `Read a reply from ${who} at ${o.company}: ${cls.replace("_", " ")}. ${parsed?.summary ?? ""}`.trim(), refTable: "permission_requests", refId: o.request_id, detail: where, llmCostUsd: c.costUsd });
  }
  // Every human reply but an out-of-office reaches a person, with the thread.
  if (cls !== "ooo" && cls !== "opt_out") {
    const to = process.env.HANDOFF_EMAIL?.trim() || "admin@onenept.com";
    await transport().sendMail({ from: `"SYZYGY" <${fromAddress()}>`, to, subject: `Reply from ${o.company} (${cls.replace("_", " ")})`,
      text: `${who} at ${o.company} replied to SYZYGY's message.\n\nTheir reply:\n${text}\n\nWhat SYZYGY sent (${o.subject}):\n${o.body}\n\nReply to them from ${fromAddress()} to pick it up.` }).catch(() => null);
  }
  return { reply: reply.id, class: cls };
}

/** The message a reply belongs to, by the Message-ID we sent, else by the sender being the address we wrote to. */
export async function outboundForReply(ids: string[], from: string | null) {
  for (const id of ids) {
    const [o] = (await sql()`select * from outbound where id = ${id}::uuid`) as Outbound[];
    if (o) return o;
  }
  if (!from) return null;
  const [o] = (await sql()`select * from outbound where lower(to_address) = ${from} and status = 'sent' order by sent_at desc limit 1`) as Outbound[];
  return o ?? null;
}
