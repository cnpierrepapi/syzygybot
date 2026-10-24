// The mail cron, every 15 minutes: approved emails whose window has come, approved letters to print-mail, letter status,
// then the mailbox. Nothing leaves without a person's approval of that message; see lib/mail.ts and lib/letters.ts.
import { withLock } from "@/lib/lock";
import { sendDueEmails } from "@/lib/mail";
import { pollLetters, sendDueLetters } from "@/lib/letters";
import { readInbox } from "@/lib/mailbox";
import { pollOutboundLetters, sendDueOutbound } from "@/lib/outbound";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const safe = async <T,>(f: () => Promise<T>) => { try { return await f(); } catch (e) { return { error: (e as Error).message.slice(0, 200) }; } };

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await withLock("mail", 290, async () => ({
    emails: await safe(() => sendDueEmails()),
    letters: await safe(() => sendDueLetters()),
    tracking: await safe(() => pollLetters()),
    // Live-run cards a person approved for real, in SYZYGY's own voice.
    outbound: await safe(() => sendDueOutbound()),
    outboundTracking: await safe(() => pollOutboundLetters()),
    inbox: await safe(() => readInbox()),
  })));
}
