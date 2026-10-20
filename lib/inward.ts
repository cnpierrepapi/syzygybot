// Inward mode. A brand that claimed its page can switch on "send these for us": the Writer then writes to
// the companies that need that brand in the brand's name, signed by whoever the brand names, and the pitch
// is a partnership with the brand (not Qloo's data). It still says up front that an AI agent wrote it, and
// still credits Qloo's taste data for the numbers.
// These messages are private to the brand: the public floor says one was written, never what it says.
// Demo workspaces (judges' test claims) get the same drafts, kept on the workspace and never sent.

import { sql } from "./db";
import { logAction } from "./actions";
import { ask, parseJson } from "./llm";
import { bestInbox, evidenceFacts, type AccountRow, type Contact } from "./outreach";
import { fillSlugs } from "./slug";
import type { DemoDraft, Workspace } from "./claim";

const n2 = (x: number | null | undefined) => (x == null ? null : Number(x.toFixed(2)));

export const signerOf = (w: Pick<Workspace, "name" | "signer">) => w.signer?.trim() || `The ${w.name} team`;

const INWARD_SYSTEM = `You write one short cold email for a brand, to a company whose audience already leans toward that brand.
You are Syzygy, an AI agent working for the brand. Hard rules:
- The first sentence says plainly that this is Syzygy, an AI agent writing for the brand (name the brand).
- The pitch is a partnership between the brand and the recipient's company, because the recipient's audience already likes the brand.
- Say the audience numbers come from Qloo's taste data. Neither you nor the brand is Qloo; never imply anyone works for Qloo.
- Quote at least two numbers from the evidence, as given. Do not invent any number, client, budget or result.
- If past_partnership is given, they worked together before: say so plainly as history, never as a new idea.
- Affinity values are Qloo scores from 0 to 1, NOT percentages: write "an affinity score of 0.91", never "91%".
- Scores are aggregate audience overlap, not proof a partnership would work; never promise outcomes.
- Under 150 words in the body. Plain and specific. No hype words, no em dashes, no exclamation marks.
- End with one ask, and the ask is a reply (never a call, a meeting or a time slot; a person from the brand takes it from there), then the evidence link given.
- Describe our match score by how it was built (from patterns in Qloo's taste data); never say Qloo hasn't measured, rated or scored something.
- Sign off with the signer line given, then on a new line: "Written and sent by Syzygy, an AI agent working for <brand>".
Reply with JSON only: {"subject":"","body":""}`;

const FOLLOW_AS_SYSTEM = `You write one short follow-up, for a brand, to a cold email that got no reply. You are Syzygy, an AI agent
working for the brand. Hard rules:
- The first sentence says it is Syzygy, an AI agent, following up for the brand (name it).
- The numbers come from Qloo's taste data; neither you nor the brand is Qloo.
- Affinity values are scores from 0 to 1, never percentages. Only numbers from the evidence. No em dashes, no exclamation marks, no hype.
- Sign off with the signer line given, then "Written and sent by Syzygy, an AI agent working for <brand>".
Reply with JSON only: {"body":""}`;

export function inwardChecks(body: string, subject: string, brand: string) {
  const first = body.slice(0, 240).toLowerCase(), all = `${subject}\n${body}`.toLowerCase();
  return {
    discloses_ai: /\bai\b|artificial intelligence/.test(first),
    names_brand: first.includes(brand.toLowerCase()),
    credits_qloo_data: /qloo['’]s taste data|qloo taste data|from qloo|built on qloo/.test(all),
    not_posing_as_qloo: !/(we at qloo|i work (at|for) qloo|from qloo['’]s team|qloo team here|on behalf of qloo|our qloo|i('m| am) (from|with) qloo)/.test(all),
    no_em_dash: !/—/.test(all),
    no_percentages: !/%|\bper ?cent\b/.test(all),
    under_150_words: body.split(/\s+/).filter(Boolean).length <= 180, // two-line signature + link included
  };
}

/** The evidence as the brand sees it: how hard the company's fans lean toward the brand. */
function inwardFacts(w: Workspace, a: AccountRow) {
  const f = evidenceFacts(a);
  return {
    brand: w.name, signer_line: `${signerOf(w)}, ${w.name}`, recipient_company: a.name,
    recipient_fans_to_brand_affinity: n2(a.evidence.pull?.accountFansLikePartner),
    brand_fans_to_recipient_affinity: n2(a.evidence.pull?.partnerFansLikeAccount),
    thesis: f.thesis, thesis_score: f.thesis_score, shared_taste: f.shared_taste, shared_cities: f.shared_cities,
    past_partnership: f.past_partnership, evidence_link: f.evidence_link,
  };
}

export async function draftAs(w: Workspace, a: AccountRow, c: Contact, to: string | null, viaInbox: boolean) {
  const prompt = JSON.stringify({
    ...inwardFacts(w, a),
    recipient: c.name ? { name: c.name, role: c.role, company: a.name } : { role: c.role, company: a.name, note: "a shared company inbox; address the team" },
    delivered_via: viaInbox ? `the company's published inbox, marked for ${c.name}'s attention` : undefined,
    channel: to ? "email" : "letter",
  });
  let checks = inwardChecks("", "", w.name), cost = 0, model = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ask("write", INWARD_SYSTEM, attempt ? `${prompt}\n\nYour last draft broke a hard rule: ${JSON.stringify(checks)}. Fix it.` : prompt, 600);
    cost += r.costUsd ?? 0; model = r.model;
    const d = parseJson<{ subject: string; body: string }>(r.text);
    if (!d?.body) continue;
    checks = inwardChecks(d.body, d.subject ?? "", w.name);
    if (Object.values(checks).every(Boolean)) return { ...d, checks, cost, model };
  }
  return { subject: "", body: "", checks, cost, model, failed: true as const };
}

export async function followUpAs(w: { name: string; signer: string | null }, brief: string, first: string, evidence: unknown, link: string) {
  const prompt = JSON.stringify({ brief, brand: w.name, signer_line: `${signerOf(w)}, ${w.name}`, first_message: first, evidence, evidence_link: link });
  let checks = inwardChecks("", "", w.name), cost = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ask("write", FOLLOW_AS_SYSTEM, attempt ? `${prompt}\n\nYour last draft broke a hard rule: ${JSON.stringify(checks)}. Fix it.` : prompt, 400);
    cost += r.costUsd ?? 0;
    const body = parseJson<{ body: string }>(r.text)?.body;
    if (!body) continue;
    checks = inwardChecks(body, "", w.name);
    if (Object.values(checks).every(Boolean)) return { body, checks, model: r.model, cost };
  }
  return { body: null, checks, model: "", cost };
}

type Target = AccountRow & { plan_id: string | null };

/** Companies that need this brand, with the latest plan for each company. */
async function targets(w: Workspace) {
  return (await sql()`
    select ac.id, ac.slug, ac.entity_id, ac.evidence, e.name, e.type, e.official_site, p.name passed_name, pr.deal_status, pr.deal_check,
      (select pl.id from plans pl join accounts x on x.id = pl.account_id where x.entity_id = ac.entity_id order by pl.created_at desc limit 1) plan_id
    from accounts ac join entities e on e.qloo_id = ac.entity_id join entities p on p.qloo_id = ac.passed_on join pairs pr on pr.id = ac.pair_id
    where ac.passed_on = ${w.entity_id} and pr.deal_status in ('clear','past') order by pr.score desc`) as Target[];
}

/** Who at a company gets a message: up to two verified people, else the best verified inbox. */
export async function recipients(entityId: string) {
  const all = (await sql()`
    select c.id, c.kind, c.name, c.role, c.email, c.role_status from contacts c join accounts x on x.id = c.account_id
    where x.entity_id = ${entityId} order by c.created_at`) as Contact[];
  const usable = all.filter(c => c.role_status === "confirmed");
  const people = usable.filter(c => c.kind === "person").slice(0, 2);
  return { people: people.length ? people : usable.slice(0, 1), route: bestInbox(all) };
}

/** Writes the brand-signed first messages that don't exist yet. `limit` caps Writer calls per run. */
export async function draftForWorkspace(w: Workspace, limit = 4) {
  if (!w.send_as || (w.claim.needs_review && !w.demo)) return { drafted: 0, skipped: "not switched on" };
  let drafted = 0, failed = 0;
  const demoDrafts: DemoDraft[] = [...(w.detail.demo_drafts ?? [])];
  for (const a of await targets(w)) {
    if (drafted + failed >= limit) break;
    const { people, route } = await recipients(a.entity_id);
    for (const c of people) {
      if (drafted + failed >= limit) break;
      const done = w.demo
        ? demoDrafts.some(d => d.contact_id === c.id)
        : ((await sql()`select 1 from touches where contact_id = ${c.id} and workspace_id = ${w.id} and status <> 'cancelled' limit 1`) as unknown[]).length > 0;
      if (done) continue;
      const viaInbox = c.kind === "person" && !c.email && !!route?.email;
      const to = c.email ?? (viaInbox ? route!.email : null);
      const d = await draftAs(w, a, c, to, viaInbox);
      const who = c.name ?? `${a.name}'s ${c.role}`;
      if ("failed" in d) {
        failed++;
        await logAction({ agent: "writer", kind: "touch.rejected", summary: `Discarded a draft to ${who} for a brand that claimed its page: it broke a hard rule twice.`, refTable: "contacts", refId: c.id, detail: { checks: d.checks, simulated: w.demo }, llmCostUsd: d.cost });
        continue;
      }
      drafted++;
      if (w.demo) {
        demoDrafts.push({ contact_id: c.id, who, company: a.name, subject: d.subject, body: d.body, checks: d.checks, at: new Date().toISOString() });
        continue;
      }
      const [row] = (await sql()`
        insert into touches (contact_id, plan_id, channel, step, subject, body, status, to_address, workspace_id, detail)
        values (${c.id}, ${a.plan_id}, ${to ? "email" : "letter"}, 1, ${d.subject}, ${d.body}, 'dry_run', ${to}, ${w.id},
                ${JSON.stringify({ model: d.model, checks: d.checks, attention: viaInbox || !to ? c.name : null, signed_as: w.name })})
        returning id`) as { id: string }[];
      // The floor shows that it happened, never what it says or who it's for.
      await logAction({ agent: "writer", kind: "touch.drafted", summary: `Wrote to ${who} at ${a.name} for a brand that claimed its page. The message is theirs, so it stays private.`, refTable: "touches", refId: row.id, llmCostUsd: d.cost });
    }
  }
  if (w.demo) await sql()`update workspaces set detail = detail || ${JSON.stringify({ demo_drafts: demoDrafts })}::jsonb where id = ${w.id}`;
  else if (drafted) await fillSlugs();
  return { drafted, failed };
}

/** Turns brand-signed sending on or off. Off calls off whatever hasn't gone yet. */
export async function setSendAs(w: Workspace, on: boolean, signer: string | null, handoffEmail: string | null) {
  await sql()`update workspaces set send_as = ${on}, signer = ${signer}, handoff_email = ${handoffEmail} where id = ${w.id}`;
  if (!on) {
    const rows = (await sql()`
      update touches set status = 'cancelled', detail = detail || ${JSON.stringify({ cancelled: `${w.name} switched sending off` })}::jsonb
      where workspace_id = ${w.id} and status in ('draft','dry_run','queued') returning id`) as { id: string }[];
    return { cancelled: rows.length };
  }
  return draftForWorkspace({ ...w, send_as: true, signer, handoff_email: handoffEmail }, 4);
}

/** Cron: keeps every switched-on workspace drafted as new companies and contacts turn up. */
export async function runInward(limit = 4) {
  const ws = (await sql()`
    select w.*, e.name from workspaces w join entities e on e.qloo_id = w.entity_id
    where w.send_as and not w.demo and w.claimed_at is not null and coalesce((w.claim->>'needs_review')::boolean, false) = false`) as Workspace[];
  const out = [];
  let left = limit;
  for (const w of ws) {
    if (left <= 0) break;
    const r = await draftForWorkspace(w, left);
    left -= r.drafted + ((r as { failed?: number }).failed ?? 0);
    out.push({ workspace: w.name, ...r });
  }
  return out;
}
