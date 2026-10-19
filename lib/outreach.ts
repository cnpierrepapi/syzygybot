// Strategist + Writer, and the pass that runs Contact finder → Verifier → Strategist → Writer per account.
// Strategist: looks up timing triggers (releases, tours, launches, new marketing hires) on public pages,
// keeps only the ones whose page it can read, and sets the angle and channels.
// Writer: one message per verified contact, built from that account's evidence. It says up front that it
// is an AI agent, says it is built on Qloo's taste data, and never claims to be Qloo.
// Nothing is sent: touches are stored as dry_run until the sending mailbox exists.

import { sql } from "./db";
import { logAction } from "./actions";
import { ask, askWeb, parseJson } from "./llm";
import { pageBacking, readAll } from "./web";
import { findContacts, type Account } from "./contacts";
import { SITE, fillSlugs } from "./slug";
import type { DealCheck } from "./dealcheck";
import { claimedEntities } from "./claim";
import { draftForWorkspace } from "./inward";


type Evidence = {
  estimate?: { score: number; strength: string } | null;
  pair?: { score: number; band: string; thesis: string | null };
  pull?: { partnerFansLikeAccount: number | null; accountFansLikePartner: number | null };
  sharedTaste?: string[];
  cities?: { shared: string[]; account: string[] };
  morePartners?: { name: string; type: string; pullOut: number; pullBack: number }[];
};
export type AccountRow = Account & { passed_name: string; evidence: Evidence; slug?: string | null; deal_status?: string | null; deal_check?: DealCheck | null };
export type Contact = { id: string; kind: string; name: string | null; role: string; email: string | null; role_status: string };
type Trigger = { what: string; date?: string; source_url?: string; verified?: boolean; page?: string };

const TRIGGER_SYSTEM = `You are the Strategist on an autonomous sales team. Find timing triggers for an outreach:
upcoming releases, tours, product launches or campaigns in the next four months, and marketing or partnership
executives hired in the last six months. Use public pages only, never LinkedIn. Reply with JSON only.`;

const PLAN_SYSTEM = `You are the Strategist on an autonomous sales team built on Qloo's taste data. The team
approaches ONE company about using Qloo's audience data; the other entity in the thesis is evidence only and is
never contacted. Given the evidence, verified contacts and verified triggers, decide:
- angle: one sentence on what will make this company care, grounded in the numbers given
Affinity values are Qloo scores from 0 to 1, NOT percentages or shares of an audience: write "an affinity score of 0.91", never "91%" or "91% of fans".
- channels: for each contact id given, "email" if it has a route, else "letter"; a short reason each
- timing: one sentence on when to send and why, citing a trigger if there is one
Use only the facts given. No hype words, no em dashes. Reply with JSON only:
{"angle":"","channels":[{"contact_id":"","channel":"email","why":""}],"timing":""}`;

const WRITER_SYSTEM = `You are the Writer on an autonomous sales team. You write one short cold email to one person.
Hard rules:
- The first sentence says plainly that you are an AI agent (named Syzygy).
- Say the analysis is built on Qloo's taste data. You are NOT Qloo and do not work for Qloo; never say "we at Qloo", "our data" or imply you are Qloo staff.
- Quote at least two specific numbers from the evidence, as given. Do not invent any number, client, budget or result.
- If pair_measured_by_qloo is false, the pair's number is SYZYGY's own match score out of 100, from patterns in Qloo's taste data:
  say exactly that, never call it a Qloo affinity, and use the Qloo-measured more_partners as the Qloo numbers.
- Mention the extra partners by name as proof the data finds more than one opportunity.
- If past_partnership is given, the two have worked together before: mention it plainly as history (the audience
  overlap is still there), and never present the pairing as a new idea.
- Affinity scores are aggregate audience overlap, not proof a partnership would work; never promise outcomes.
- Affinity values are Qloo scores from 0 to 1, NOT percentages or shares of an audience: write "an affinity score of 0.91", never "91%" or "91% of fans".
- Under 150 words in the body. Plain, specific, no hype words, no em dashes, no exclamation marks.
- End with one low-effort ask (a 20-minute call, or a reply) and the evidence link given.
- Sign off as "Syzygy (an AI agent)".
Reply with JSON only: {"subject":"","body":""}`;

const n2 = (x: number | null | undefined) => (x == null ? null : Number(x.toFixed(2)));

export function writerChecks(body: string, subject: string) {
  const first = body.slice(0, 220).toLowerCase();
  const all = `${subject}\n${body}`.toLowerCase();
  return {
    discloses_ai: /\bai\b|artificial intelligence/.test(first),
    credits_qloo_data: /qloo['’]s taste data|built on qloo/.test(all),
    not_posing_as_qloo: !/(we at qloo|i work (at|for) qloo|from qloo['’]s team|qloo team here|on behalf of qloo|our qloo|i('m| am) (from|with) qloo)/.test(all),
    no_em_dash: !/—/.test(all),
    // The evidence holds no percentages, so a "%" means a 0-1 affinity score was misread as a share of fans.
    no_percentages: !/%|\bper ?cent\b/.test(all),
    under_150_words: body.split(/\s+/).filter(Boolean).length <= 170, // signature + link included
  };
}

async function triggers(a: AccountRow): Promise<{ list: Trigger[]; costUsd: number }> {
  try {
    const web = await askWeb(
      `Timing triggers for "${a.name}"${a.official_site ? ` (${a.official_site})` : ""}. JSON shape:
{"triggers":[{"what":"","date":"YYYY-MM-DD","source_url":""}]} At most 4, each with the exact public URL that states it.`,
      TRIGGER_SYSTEM, 800);
    const raw = (parseJson<{ triggers?: Trigger[] }>(web.text)?.triggers ?? []).filter(t => t?.what).slice(0, 4);
    // Keep a trigger only if a page the Strategist can read itself backs it.
    const pages = await readAll([...raw.map(t => t.source_url ?? ""), ...web.sources.map(s => s.url)]);
    const list = raw.map(t => {
      const page = pageBacking(pages, a.name, t.what);
      return { ...t, verified: !!page, page: page?.url, date: t.date };
    });
    return { list, costUsd: web.costUsd };
  } catch { return { list: [], costUsd: 0 }; }
}

export function evidenceFacts(a: AccountRow) {
  const e = a.evidence;
  return {
    account: a.name, account_type: a.type, evidence_only_partner: a.passed_name,
    thesis: e.pair?.thesis, thesis_score: n2(e.pair?.score), band: e.pair?.band,
    // Estimated pairs: our score, not a Qloo number. The writer must say so.
    syzygy_match_score_out_of_100: e.estimate ? e.estimate.score : undefined,
    pair_measured_by_qloo: e.estimate ? false : undefined,
    affinity_partner_fans_to_account: n2(e.pull?.partnerFansLikeAccount),
    affinity_account_fans_to_partner: n2(e.pull?.accountFansLikePartner),
    shared_taste: e.sharedTaste?.slice(0, 6), shared_cities: e.cities?.shared,
    more_partners: e.morePartners?.map(p => ({ name: p.name, type: p.type, affinity_out: n2(p.pullOut), affinity_back: n2(p.pullBack) })),
    evidence_link: `${SITE}/account/${a.slug ?? a.id}`,
    // The Deal check found an older partnership between the two: say so, never pitch the pairing as new.
    past_partnership: a.deal_status === "past" && a.deal_check?.findings[0]
      ? { what: a.deal_check.findings[0].kind, year: a.deal_check.findings[0].year, quote: a.deal_check.findings[0].quote } : undefined,
  };
}

export async function planAccount(a: AccountRow, contacts: Contact[], hasInbox: boolean) {
  const t = await triggers(a);
  const facts = evidenceFacts(a);
  const routes = contacts.map(c => ({ contact_id: c.id, who: c.name ? `${c.name}, ${c.role}` : c.role, has_email_route: c.kind === "inbox" || hasInbox }));
  const input = JSON.stringify({ ...facts, contacts: routes, triggers: t.list.filter(x => x.verified) });
  let r = await ask("write", PLAN_SYSTEM, input, 600);
  type Plan = { angle: string; channels: { contact_id: string; channel: string; why: string }[]; timing: string };
  let plan = parseJson<Plan>(r.text);
  if (plan?.angle && /%|\bper ?cent\b/i.test(plan.angle)) {
    const cost = r.costUsd ?? 0;
    r = await ask("write", PLAN_SYSTEM, `${input}

Your last angle turned an affinity score into a percentage. Affinity is a 0 to 1 score. Rewrite without any percentages.`, 600);
    r = { ...r, costUsd: (r.costUsd ?? 0) + cost };
    plan = parseJson<Plan>(r.text);
  }
  if (!plan?.angle || /%|\bper ?cent\b/i.test(plan.angle)) throw new Error("strategist returned no usable plan");
  const [row] = (await sql()`
    insert into plans (account_id, angle, channels, triggers, detail)
    values (${a.id}, ${plan.angle}, ${JSON.stringify(plan.channels ?? [])}, ${JSON.stringify(t.list)},
            ${JSON.stringify({ timing: plan.timing, model: r.model })})
    returning id`) as { id: string }[];
  const verified = t.list.filter(x => x.verified).length;
  await logAction({
    agent: "strategist", kind: "plan.set",
    summary: `Plan for ${a.name}: ${plan.angle.replace(/\.$/, "")}. ${verified} verified timing trigger${verified === 1 ? "" : "s"}.`,
    refTable: "plans", refId: row.id, llmCostUsd: (r.costUsd ?? 0) + t.costUsd,
  });
  return { id: row.id, ...plan, triggers: t.list };
}

const INBOX_RANK = [/partner|sponsor|collab|brand/, /market/, /licens|business/, /press|media|pr@/, /info|hello|contact/];
export function bestInbox(contacts: Contact[]) {
  const inboxes = contacts.filter(c => c.kind === "inbox" && c.role_status === "confirmed" && c.email);
  for (const re of INBOX_RANK) { const hit = inboxes.find(c => re.test(c.email!)); if (hit) return hit; }
  return inboxes[0] ?? null;
}

export async function writeTouch(a: AccountRow, plan: { id: string; angle: string; timing: string }, c: Contact, route: Contact | null, context?: Record<string, unknown>) {
  const facts = evidenceFacts(a);
  // A person's own address only exists if it was published or they gave it in a reply; it is never guessed.
  const viaInbox = c.kind === "person" && !c.email && !!route?.email;
  const to = c.email ?? (viaInbox ? route!.email : null);
  const prompt = JSON.stringify({
    recipient: c.name ? { name: c.name, role: c.role, company: a.name } : { role: c.role, company: a.name, note: "a shared company inbox; address the team" },
    delivered_via: viaInbox ? `the company's published inbox, marked for ${c.name}'s attention` : undefined,
    angle: plan.angle, timing: plan.timing, ...facts, ...context,
  });
  let draft: { subject: string; body: string } | null = null, checks = writerChecks("", ""), model = "", cost = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ask("write", WRITER_SYSTEM, attempt ? `${prompt}\n\nYour last draft broke a hard rule: ${JSON.stringify(checks)}. Fix it.` : prompt, 500);
    model = r.model; cost += r.costUsd ?? 0;
    draft = parseJson<{ subject: string; body: string }>(r.text);
    if (!draft?.body) continue;
    checks = writerChecks(draft.body, draft.subject ?? "");
    if (Object.values(checks).every(Boolean)) break;
  }
  const passed = !!draft?.body && Object.values(checks).every(Boolean);
  if (!passed) {
    await logAction({ agent: "writer", kind: "touch.rejected", summary: `Discarded a draft for ${c.name ?? a.name}: it broke a hard rule twice.`, refTable: "contacts", refId: c.id, detail: { checks }, llmCostUsd: cost });
    return null;
  }
  const channel = to ? "email" : "letter";
  const [row] = (await sql()`
    insert into touches (contact_id, plan_id, channel, step, subject, body, status, to_address, detail)
    values (${c.id}, ${plan.id}, ${channel}, 1, ${draft!.subject}, ${draft!.body}, 'dry_run', ${to},
            ${JSON.stringify({ model, checks, attention: viaInbox || !to ? c.name : null })})
    returning id`) as { id: string }[];
  await logAction({
    agent: "writer", kind: "touch.drafted",
    summary: `Wrote to ${c.name ?? `${a.name}'s ${c.role}`}: "${draft!.subject}". Held as a dry run until the mailbox is live.`,
    refTable: "touches", refId: row.id, llmCostUsd: cost,
  });
  return row.id;
}

/** Accounts with no contacts yet get the full pass. One or two per cron run keeps it inside the time limit. */
export async function runOutreach(limit = 1, accountId?: string) {
  await fillSlugs(); // evidence links in the messages use the account's readable address
  const rows = (await sql()`
    select ac.id, ac.slug, ac.entity_id, ac.passed_on, ac.evidence, e.name, e.type, e.official_site, p.name passed_name, pr.deal_status, pr.deal_check
    from accounts ac join entities e on e.qloo_id = ac.entity_id left join entities p on p.qloo_id = ac.passed_on join pairs pr on pr.id = ac.pair_id
    where (${accountId ?? null}::uuid is null or ac.id = ${accountId ?? null}::uuid)
      and pr.deal_status in ('clear','past') -- the Deal check has cleared this thesis
      -- Skip a company once it has a verified contact; one with none is searched again after 7 days.
      and not exists (select 1 from contacts c join accounts x on x.id = c.account_id where x.entity_id = ac.entity_id
                      and (c.role_status = 'confirmed' or c.created_at > now() - interval '7 days'))
      and not exists (select 1 from plans pl join accounts x on x.id = pl.account_id where x.entity_id = ac.entity_id)
    order by (select max(c.created_at) from contacts c where c.account_id = ac.id) asc nulls first, ac.created_at asc
    limit ${limit}`) as (AccountRow & { passed_on: string | null })[];
  const claimed = await claimedEntities();
  const out = [];
  for (const a of rows) {
    try {
      await findContacts(a);
      const contacts = (await sql()`select id, kind, name, role, email, role_status from contacts where account_id = ${a.id}`) as Contact[];
      const usable = contacts.filter(c => c.role_status === "confirmed");
      if (!usable.length) {
        await logAction({ agent: "strategist", kind: "plan.blocked", summary: `No verified contact at ${a.name} yet, so no outreach plan. It gets searched again in 7 days.`, refTable: "accounts", refId: a.id });
        out.push({ account: a.name, contacts: contacts.length, verified: 0, touches: 0 });
        continue;
      }
      const people = usable.filter(c => c.kind === "person").slice(0, 2);
      const targets = people.length ? people : usable.slice(0, 1);
      const route = bestInbox(contacts);
      const plan = await planAccount(a, targets, !!route);
      let touches = 0;
      // A brand that claimed its page decides who writes to the companies that need it: SYZYGY in the
      // brand's name if it switched sending on, otherwise nobody (the contacts and plan go in its playbook).
      const w = a.passed_on ? claimed.get(a.passed_on) : undefined;
      if (w) {
        if (w.send_as && !w.claim.needs_review) touches = (await draftForWorkspace(w, targets.length)).drafted;
        else await logAction({ agent: "writer", kind: "touch.held", summary: `Found who to write to at ${a.name}, but ${a.passed_name} claimed its page, so SYZYGY doesn't pitch ${a.name} about them. It's in their playbook instead.`, refTable: "accounts", refId: a.id });
      } else for (const c of targets) if (await writeTouch(a, plan, c, route)) touches++;
      out.push({ account: a.name, contacts: contacts.length, verified: usable.length, touches });
    } catch (e) {
      await logAction({ agent: "contact_finder", kind: "outreach.error", summary: `Outreach pass for ${a.name} stopped on an error.`, refTable: "accounts", refId: a.id, detail: { error: (e as Error).message.slice(0, 300) } });
      out.push({ account: a.name, error: (e as Error).message });
    }
  }
  await fillSlugs();
  return out;
}
