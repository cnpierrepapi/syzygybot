// Mailbox: reads agent@syzygybot.com over IMAP and hands each reply to the Inbox agent as a real (not simulated) reply.
// A reply is matched to our message by its In-Reply-To / References header (every message we send carries
// <touch-id@syzygybot.com>), else by the sender being the address we wrote to. Bounces mark the message bounced and the
// address invalid, and stop the sequence. Anything that matches nothing stays in the mailbox for a person.
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { sql } from "./db";
import { logAction } from "./actions";
import { handleReply } from "./inbox";
import { stopSequence } from "./sequencer";

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@syzygybot\.com/gi;

/** Their words only: cuts the quoted thread and signature delimiters. */
export function stripQuoted(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const cut = lines.findIndex(l => /^\s*>/.test(l) || /^On .+wrote:\s*$/i.test(l) || /^-{2,}\s*Original Message/i.test(l)
    || /^From:\s/i.test(l) || /^_{5,}/.test(l) || /^-- ?$/.test(l));
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}

const isBounce = (m: ParsedMail) =>
  /mailer-daemon|postmaster/i.test(m.from?.value[0]?.address ?? "") || /multipart\/report/i.test(String(m.headers.get("content-type") ?? ""));

async function touchFor(m: ParsedMail, raw: string) {
  const refs = [m.inReplyTo ?? "", ...(Array.isArray(m.references) ? m.references : m.references ? [m.references] : [])].join(" ");
  // Bounces quote our message, so its id is somewhere in the raw source rather than the headers.
  const ids = [...(isBounce(m) ? raw : refs).matchAll(UUID)].map(x => x[1].toLowerCase());
  for (const id of ids.reverse()) {
    const [t] = (await sql()`select id, contact_id from touches where id = ${id}::uuid`) as { id: string; contact_id: string }[];
    if (t) return t;
  }
  const from = m.from?.value[0]?.address?.toLowerCase();
  if (!from || isBounce(m)) return null;
  const [t] = (await sql()`select id, contact_id from touches where lower(to_address) = ${from} and status = 'sent' order by sent_at desc limit 1`) as { id: string; contact_id: string }[];
  return t ?? null;
}

async function bounced(t: { id: string; contact_id: string }) {
  await sql()`update touches set status = 'bounced', detail = detail || '{"bounced": true}'::jsonb where id = ${t.id}`;
  await sql()`update contacts set email_status = 'invalid' where id = ${t.contact_id}`;
  const n = await stopSequence({ contactId: t.contact_id }, "the address bounced");
  await logAction({ agent: "inbox", kind: "touch.bounced", summary: `A message bounced. The address is marked invalid and ${n} unsent follow-up${n === 1 ? "" : "s"} cancelled.`, refTable: "touches", refId: t.id });
}

/** Reads every message that arrived since the last run. Read-only on the mailbox apart from marking messages seen. */
export async function readInbox(max = 25) {
  const user = process.env.ZOHO_MAIL_USER, pass = process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) throw new Error("ZOHO_MAIL_USER / ZOHO_APP_PASSWORD not set");
  const client = new ImapFlow({ host: process.env.ZOHO_IMAP_HOST ?? "imap.zoho.eu", port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  const out: { uid: number; matched: boolean; kind: string }[] = [];
  const lock = await client.getMailboxLock("INBOX");
  try {
    const box = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
    const validity = Number(box?.uidValidity ?? 0);
    const [st] = (await sql()`select uid_validity, last_uid from mailbox_state where name = 'INBOX'`) as { uid_validity: string | null; last_uid: string }[];
    // A new UIDVALIDITY means the server renumbered the box: start over (replies are deduped on Message-ID).
    let last = st && Number(st.uid_validity) === validity ? Number(st.last_uid) : 0;
    if (!st) {
      // First run: nothing has been sent yet, so what's already there (Zoho's welcome mail) is baseline, not replies.
      const base = Math.max(0, Number(box?.uidNext ?? 1) - 1);
      await sql()`insert into mailbox_state (name, uid_validity, last_uid) values ('INBOX', ${validity}, ${base}) on conflict do nothing`;
      return [{ uid: base, matched: false, kind: "baseline" }];
    }
    const msgs: { uid: number; source: Buffer }[] = [];
    for await (const msg of client.fetch(`${last + 1}:*`, { uid: true, source: true }, { uid: true })) {
      if (msg.uid > last && msg.source) msgs.push({ uid: msg.uid, source: msg.source });
      if (msgs.length >= max) break;
    }
    for (const { uid, source } of msgs) {
      const raw = source.toString("utf8");
      const m = await simpleParser(source);
      const mid = m.messageId ?? `uid:${validity}:${uid}`;
      const [seen] = (await sql()`select 1 from replies where detail->>'message_id' = ${mid}`) as unknown[];
      const t = seen ? null : await touchFor(m, raw);
      let kind = seen ? "duplicate" : "unmatched";
      if (t && isBounce(m)) { await bounced(t); kind = "bounce"; }
      else if (t) {
        const text = stripQuoted(m.text ?? "") || (m.subject ?? "").trim();
        const r = await handleReply(t.id, text.slice(0, 5000), false);
        await sql()`update replies set detail = detail || ${JSON.stringify({ message_id: mid, from: m.from?.value[0]?.address ?? null, received: m.date?.toISOString() ?? null })}::jsonb where id = ${r.reply}`;
        kind = r.class;
      } else if (!seen) {
        await logAction({ agent: "inbox", kind: "mail.unmatched", summary: "An email came in that isn't a reply to any of our messages. Left in the mailbox for a person." });
      }
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      last = uid;
      await sql()`insert into mailbox_state (name, uid_validity, last_uid) values ('INBOX', ${validity}, ${last})
        on conflict (name) do update set uid_validity = excluded.uid_validity, last_uid = excluded.last_uid, updated_at = now()`;
      out.push({ uid, matched: !!t, kind });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return out;
}
