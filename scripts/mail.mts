// npm run mail -- status | gates <touch> | approve <touch> | send <touch> | letter <touch> | inbox | letters | quota
// approve is his go for ONE message. send/letter run it now (email still needs MAIL_LIVE=1 and the window; letters use the
// PostGrid test key unless POSTGRID_LIVE=1).
import { sql } from "../lib/db";
import { approve, gates, mailLive, render, sendEmail } from "../lib/mail";
import { approveLetter, lettersLive, pollLetters, sendLetter } from "../lib/letters";
import { readInbox } from "../lib/mailbox";
import { searchesLeft } from "../lib/hunter";

const [cmd, id] = process.argv.slice(2);
const one = async () => {
  const [t] = (await sql()`select t.*, c.name contact_name, c.role_status, c.verification, ac.entity_id, e.name company, e.official_site site, ac.tz
    from touches t join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    where t.id::text = ${id} or t.slug = ${id}`) as any[];
  if (!t) throw new Error(`no touch ${id}`);
  return t;
};

if (cmd === "status") {
  console.log({ MAIL_LIVE: mailLive(), POSTGRID_LIVE: lettersLive() });
  console.log(await sql()`select channel, status, count(*)::int n from touches group by 1, 2 order by 1, 2`);
} else if (cmd === "next") {
  console.log(await sql()`select t.id, t.channel, t.step, e.name company, c.name person, t.scheduled_for from touches t join contacts c on c.id = t.contact_id
    join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
    where t.status = 'dry_run' and t.step = 1 and t.channel = ${id ?? "email"} order by t.created_at desc limit 8`);
} else if (cmd === "gates") {
  const t = await one();
  for (const g of await gates(t)) console.log(g.pass ? "PASS" : "HOLD", g.gate.padEnd(16), g.note);
  if (t.channel === "email") { const m = await render(t); console.log("\n--- would send ---\nTo:", m.to, "\nSubject:", m.subject, "\n\n" + m.text); }
} else if (cmd === "approve") {
  const t = await one();
  console.log(t.channel === "letter" ? await approveLetter(t.id, "admin") : await approve(t.id, "admin"));
} else if (cmd === "send") console.log(JSON.stringify(await sendEmail((await one()).id), null, 1));
else if (cmd === "letter") console.log(await sendLetter((await one()).id));
else if (cmd === "letters") console.log(await pollLetters());
else if (cmd === "inbox") console.log(await readInbox());
else if (cmd === "quota") console.log(await searchesLeft());
else console.log("npm run mail -- status | gates <touch> | approve <touch> | send <touch> | letter <touch> | inbox | letters | quota");
