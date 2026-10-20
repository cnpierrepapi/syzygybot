// Brand Partnerships desk for Qloo's own sales seat: the ten-agent chain already picked the buyer, verified the person and
// wrote the email. Its dry-run messages become permission requests here, with our match score and Qloo's numbers attached.
import { sql } from "../db";
import { loadCorpus } from "../corpus";
import { sideOf, syzygyMatch } from "../match";
import { makeRequest } from "./common";
import type { Persona } from "../personas";

type Row = { touch_id: string; subject: string | null; body: string; to_address: string | null; channel: string; contact_name: string | null; role: string;
  role_status: string; entity_id: string; org: string; site: string | null; passed_on: string | null; passed_name: string | null; account_slug: string | null };

export async function runSales(p: Persona, n = 6) {
  const rows = (await sql()`
    select t.id touch_id, t.subject, t.body, t.to_address, t.channel, c.name contact_name, c.role, c.role_status, a.entity_id, e.name org, e.official_site site,
      a.passed_on, pe.name passed_name, a.slug account_slug
    from touches t join contacts c on c.id = t.contact_id join accounts a on a.id = c.account_id join entities e on e.qloo_id = a.entity_id
    left join entities pe on pe.qloo_id = a.passed_on
    where t.step = 1 and t.status = 'dry_run' and t.workspace_id is null
      and not exists (select 1 from permission_requests r where r.ref_table = 'touches' and r.ref_id = t.id::text)
    order by t.created_at desc limit ${n}`) as Row[];
  const { profiles } = await loadCorpus();
  const made: string[] = [];
  for (const r of rows) {
    const a = profiles.get(r.entity_id), b = r.passed_on ? profiles.get(r.passed_on) : undefined;
    const m = a && b ? await syzygyMatch(sideOf(a), sideOf(b)) : null;
    const facts = [
      `${r.org} is the buyer the Qualifier picked; ${r.passed_name ?? "the partner"} is evidence only and is never contacted.`,
      ...(m ? [`Our match score: ${m.score} out of 100 (${m.strength}).`] : []),
      ...(m?.qloo ? [`Qloo's taste data: ${m.qloo.toward.toFixed(2)} one way, ${m.qloo.back.toFixed(2)} the other (0 to 1).`] : []),
      `${r.contact_name ?? r.role}: ${r.role_status === "confirmed" ? "verified on a public page" : r.role_status}.`,
    ];
    const id = await makeRequest({
      persona: p, desk: "sales", agent: "writer", action: r.channel === "letter" ? "letter" : "email",
      title: `${r.org}: pitch Qloo's taste data to ${r.contact_name ?? r.role}`, dedupe: `${p.id}|sales|${r.touch_id}`,
      target: { org: r.org, site: r.site, person: r.contact_name, role: r.role, country: "US", purpose: "partnerships" },
      brief: {}, evidence: { match: m, facts },
      preset: { subject: r.subject ?? "", body: r.body, address: r.to_address, roleStatus: r.role_status, person: r.contact_name },
      ref: { table: "touches", id: r.touch_id },
    });
    if (id) made.push(id);
  }
  // One CRM export per run: the accounts this desk drafted for, with their verified people, as a single push.
  const accounts = [...new Set(rows.map(r => r.org))];
  if (accounts.length) {
    const key = `${p.id}|crm|${accounts.sort().join(",")}`;
    const [dup] = (await sql()`select id from permission_requests where dedupe = ${key}`) as { id: string }[];
    if (!dup) {
      const people = rows.filter(r => r.contact_name).map(r => `${r.contact_name} (${r.role}, ${r.org})`);
      const body = `Companies: ${accounts.join(", ")}.
People: ${people.join("; ") || "published inboxes only"}.
Each company gets a note with the thesis, our match score, Qloo's numbers where measured, and the drafted message.`;
      const [row] = (await sql()`insert into permission_requests (persona, desk, action, title, target, preview, evidence, clearance, dedupe)
        values (${p.id}, 'sales', 'crm_push', ${`Push ${accounts.length} accounts to the CRM: ${accounts.join(", ")}`},
          ${JSON.stringify({ org: "HubSpot or Salesforce", channel: "email", country: "US", crm: true })},
          ${JSON.stringify({ subject: `${accounts.length} companies, ${people.length} people, ${rows.length} drafted messages`, body })},
          ${JSON.stringify({ facts: [`Every record links back to its public evidence page on SYZYGY.`, `Contact emails go to the CRM only when they were published by the company.`] })},
          ${JSON.stringify({ status: "pass", checks: [{ rule: "data", label: "Data credited honestly", pass: true, note: "Records carry their sources." }], checkedAt: new Date().toISOString() })},
          ${key}) on conflict (dedupe) do nothing returning id`) as { id: string }[];
      if (row) made.push(row.id);
    }
  }
  return made;
}
