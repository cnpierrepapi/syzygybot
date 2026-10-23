// npm run bakeoff -- <test> <model> [out.json]
// One model on one kind of call, pinned with no fallback, on real inputs from the database. Tests:
//   pen     the outbound draft (draft()), on 10 open live cards, brief rebuilt from each card's own lane
//   write   the contact finder (findBuyer, Google Search), on 12 orgs whose person we already confirmed; nothing is saved
//   fast    the deal-conflict check (Clearance) and the reply sorter (Inbox), on hand-labelled cases
// Run one process per model (the pin is per process) and compare the JSON files.
import { writeFileSync } from "node:fs";
import { sql } from "../lib/db";
import { pinModel, tally, ask, parseJson } from "../lib/llm";
import { draft, findBuyer } from "../lib/desks/common";
import { clear, DEFAULT_RULES } from "../lib/clearance";
import { loadPersona } from "../lib/personas";
import { planOf, type Lane } from "../lib/live/plans";

const [test, model, out = `bakeoff-${test}-${model}.json`] = process.argv.slice(2);
if (!["pen", "write", "fast"].includes(test) || !model) { console.error("usage: bakeoff <pen|write|fast> <model> [out]"); process.exit(1); }
pinModel(test as "pen" | "write" | "fast", model);
const timed = async <T,>(f: () => Promise<T>) => { const t0 = Date.now(); try { return { ok: true as const, v: await f(), s: (Date.now() - t0) / 1000 }; } catch (e) { return { ok: false as const, err: String((e as Error).message).slice(0, 160), s: (Date.now() - t0) / 1000 }; } };
const rows: unknown[] = [];

if (test === "pen") {
  // The same 10 cards for every model: open live cards, newest first, at most 2 per desk.
  const cards = (await sql()`select r.id, r.persona, r.title, r.target, r.evidence from permission_requests r
    where r.run_id is not null and r.action <> 'crm_push' and not exists (select 1 from request_decisions d where d.request_id = r.id)
    order by r.created_at desc limit 80`) as any[];
  const per = new Map<string, number>(), picked: any[] = [];
  for (const c of cards) if ((per.get(c.persona) ?? 0) < 2 && picked.length < 10) { per.set(c.persona, (per.get(c.persona) ?? 0) + 1); picked.push(c); }
  const lanes = new Map<string, Lane[]>();
  for (const c of picked) {
    if (!lanes.has(c.persona)) {
      await loadPersona(c.persona);
      const plan = planOf(c.persona);
      lanes.set(c.persona, plan?.kind === "pitch" ? await Promise.resolve(typeof plan.lanes === "function" ? plan.lanes() : plan.lanes).catch(() => [] as Lane[]) : []);
    }
    const ask = lanes.get(c.persona)!.find(l => l.title(c.target.org) === c.title)?.ask(c.target.org)
      ?? "A partnership pitch, because the audiences lean toward each other in Qloo's taste data, both ways. Ask them to reply if they want the full numbers.";
    const p = await loadPersona(c.persona);
    const r = await timed(() => draft({ kind: ask, sender: p?.title ?? c.persona, facts: c.evidence.facts, recipient: c.target.org,
      ...(c.target.person ? { recipient_person: { name: c.target.person, role: c.target.role } } : {}) }));
    rows.push({ card: c.id, title: c.title, facts: c.evidence.facts, s: r.s, ...(r.ok ? { draft: r.v.draft } : { err: r.err }) });
    console.log(model, r.s.toFixed(0) + "s", r.ok && r.v.draft ? "ok" : "FAIL", c.title);
  }
}

if (test === "write") {
  // Orgs where a person was confirmed on a page we read: did this model find someone it can prove, and the same person?
  const known = (await sql()`select distinct on (p.org) p.org, p.purpose, p.name, r.target->>'site' site
    from org_people p join permission_requests r on r.target->>'org' = p.org and r.target->>'person' = p.name
    where p.status = 'confirmed' order by p.org, p.checked_at desc`) as { org: string; purpose: any; name: string; site: string | null }[];
  const sample = known.sort((a, b) => a.org.localeCompare(b.org)).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 12)) === 0).slice(0, 12);
  for (const k of sample) {
    const r = await timed(() => findBuyer(k.org, k.site, k.purpose, "US", { hunter: false, sweep: false, cache: false }));
    const found = r.ok ? r.v : null;
    rows.push({ org: k.org, purpose: k.purpose, known: k.name, found: found?.name ?? null, role: found?.role ?? null, page: found?.page ?? null,
      same: !!found && found.name.toLowerCase() === k.name.toLowerCase(), s: r.s, ...(r.ok ? {} : { err: r.err }) });
    console.log(model, r.s.toFixed(0) + "s", k.org, "->", found?.name ?? (r.ok ? "none" : `ERR ${r.err}`), "| known", k.name);
  }
}

if (test === "fast") {
  // Deal conflicts: [the talent's deal, its category, the new brand, should it conflict?]
  const DEALS: [string, string, string, boolean][] = [
    ["Adidas", "sportswear", "Puma", true], ["Adidas", "sportswear", "FC Barcelona", false], ["Corona", "beer", "Heineken", true],
    ["Corona", "beer", "Starbucks", false], ["Apple", "phones", "Samsung", true], ["Gucci", "fashion", "Prada", true],
    ["Gucci", "fashion", "Sephora", false], ["Pepsi", "soft drinks", "Sprite", true], ["Pepsi", "soft drinks", "Live Nation", false],
    ["Cheetos", "snacks", "Lay's", true], ["Maybelline", "cosmetics", "NYX Professional Makeup", true], ["Maybelline", "cosmetics", "Fabletics", false],
    ["Patrón Tequila", "tequila", "Don Julio", true], ["Patrón Tequila", "tequila", "Ulta", false], ["Calvin Klein", "underwear", "Victoria's Secret", true],
    ["Nike", "sportswear", "Spotify", false], ["Verizon", "wireless carrier", "T-Mobile", true], ["Verizon", "wireless carrier", "Netflix", false],
  ];
  for (const [deal, category, brand, want] of DEALS) {
    const r = await timed(() => clear({ channel: "email", subject: "x", body: "An AI agent drafted this.", address: null, addressSource: null,
      roleStatus: "confirmed", country: "US", talent: ["Test Talent"], targetBrand: brand, usesQloo: true,
      talentDeals: [{ brand: deal, category, exclusive: true, year: 2026, source: "" }] }, DEFAULT_RULES));
    const got = r.ok ? !r.v.checks.find(c => c.rule === "exclusivity")!.pass : null;
    rows.push({ kind: "conflict", case: `${deal} (${category}) vs ${brand}`, want, got, right: got === want, s: r.s, ...(r.ok ? {} : { err: r.err }) });
  }
  // Replies: [their reply, the class it should get]
  const REPLIES: [string, string][] = [
    ["Sounds interesting. Can you send the full numbers?", "interested"],
    ["We'd love to hear more. What would the activation look like?", "interested"],
    ["Interesting data. Send us a sample read for our brand.", "interested"],
    ["Not this quarter. Check back in January.", "not_now"],
    ["Our budget is locked for 2026, but reach out next spring.", "not_now"],
    ["I'm not the right person. Try Maria Lopez, our head of partnerships, maria.lopez@example.com.", "referral"],
    ["Forwarding this to our agency. James Reed at Wasserman handles these.", "referral"],
    ["Please remove me from your list.", "opt_out"],
    ["unsubscribe", "opt_out"],
    ["Stop emailing me. This is spam.", "opt_out"],
    ["I'm out of the office until November 3 with limited access to email.", "ooo"],
    ["Who are you and how did you get this address?", "other"],
    ["Thanks.", "other"],
  ];
  const { CLASSIFY_SYSTEM } = await import("../lib/inbox");
  for (const [text, want] of REPLIES) {
    const r = await timed(() => ask("fast", CLASSIFY_SYSTEM, JSON.stringify({ our_message: "An AI agent (SYZYGY) drafted this for Becky G's desk. Becky G's fans lean toward your brand in Qloo's taste data. Want the full numbers?", their_reply: text }), 400));
    const got = r.ok ? parseJson<{ class: string }>(r.v.text)?.class ?? null : null;
    rows.push({ kind: "reply", case: text, want, got, right: got === want, s: r.s, ...(r.ok ? {} : { err: r.err }) });
  }
  console.log(model, "right:", rows.filter((r: any) => r.right).length, "of", rows.length);
}

writeFileSync(out, JSON.stringify({ test, model, tally: Object.fromEntries(tally), rows }, null, 1));
process.exit(0);
