// CRM sync for claimed brands. A workspace is brand X; its CRM receives the brands that need X: every
// account where X was the evidence side (accounts.passed_on = X). Each one lands as a company, its verified
// decision makers as contacts, and the thesis, numbers, angle and drafted message as a note.
// Idempotent: crm_records remembers what became what, so a re-sync only adds what's new.
// Private to the brand: nothing here is logged to the public floor.

import { sql } from "../db";
import { open, seal } from "../crypto";
import { SITE } from "../slug";
import { safeTags } from "../match";
import { hubspot } from "./hubspot";
import { salesforce } from "./salesforce";
import { CrmError, domainOf, splitName, type Crm, type Tokens } from "./types";

export const PROVIDERS: Record<string, Crm> = { hubspot, salesforce };
export const redirectUri = (provider: string) => `${process.env.CRM_REDIRECT_BASE || SITE}/api/crm/${provider}/callback`;

type Conn = { id: string; workspace_id: string; provider: string; access_enc: string; refresh_enc: string | null; instance_url: string | null; external_id: string | null; expires_at: string };

export async function saveConnection(workspaceId: string, provider: string, t: Tokens) {
  await sql()`
    insert into crm_connections (workspace_id, provider, access_enc, refresh_enc, instance_url, external_id, expires_at)
    values (${workspaceId}, ${provider}, ${seal(t.access)}, ${t.refresh ? seal(t.refresh) : null}, ${t.instanceUrl ?? null}, ${t.externalId ?? null}, ${new Date(t.expiresAt).toISOString()})
    on conflict (workspace_id, provider) do update set access_enc = excluded.access_enc, refresh_enc = coalesce(excluded.refresh_enc, crm_connections.refresh_enc),
      instance_url = coalesce(excluded.instance_url, crm_connections.instance_url), external_id = coalesce(excluded.external_id, crm_connections.external_id),
      expires_at = excluded.expires_at, last_error = null`;
}

/** Live tokens for a connection, refreshed (and re-saved) when they're about to run out. */
async function tokensFor(c: Conn, crm: Crm): Promise<Tokens> {
  let t: Tokens = { access: open(c.access_enc), refresh: c.refresh_enc ? open(c.refresh_enc) : null, expiresAt: Date.parse(c.expires_at), instanceUrl: c.instance_url, externalId: c.external_id };
  if (t.expiresAt - Date.now() < 120_000 && t.refresh) {
    const fresh = await crm.refresh(t);
    t = { ...fresh, instanceUrl: fresh.instanceUrl ?? t.instanceUrl, externalId: fresh.externalId ?? t.externalId };
    await saveConnection(c.workspace_id, c.provider, t);
  }
  return t;
}

async function remembered(connId: string, type: string, localId: string) {
  const [r] = (await sql()`select remote_id from crm_records where connection_id = ${connId} and local_type = ${type} and local_id = ${localId}`) as { remote_id: string }[];
  return r?.remote_id ?? null;
}
const remember = (connId: string, type: string, localId: string, remoteId: string) => sql()`
  insert into crm_records (connection_id, local_type, local_id, remote_id) values (${connId}, ${type}, ${localId}, ${remoteId})
  on conflict (connection_id, local_type, local_id) do update set remote_id = excluded.remote_id, synced_at = now()`;

type Target = {
  account_id: string; account_slug: string | null; name: string; official_site: string | null; evidence: Record<string, unknown>;
  thesis: string | null; score: number | null; band: string | null; angle: string | null; timing: string | null;
};

/** The note a brand reads in its CRM: why this company needs them, in numbers, and what to say. */
export function noteBody(brand: string, t: Target, people: string[], draft: string | null) {
  const pull = (t.evidence.pull ?? {}) as { partnerFansLikeAccount?: number | null; accountFansLikePartner?: number | null };
  const shared = safeTags(t.evidence.sharedTaste as string[] | undefined).slice(0, 8);
  const lines = [
    `${t.name} needs ${brand}. Found by SYZYGY, an AI sales team built on Qloo's taste data.`,
    t.thesis ? `Thesis${t.band ? ` (${t.band} ${Number(t.score).toFixed(2)})` : ""}: ${t.thesis}` : "",
    pull.partnerFansLikeAccount != null ? `Affinity: ${brand}'s audience scores ${t.name} at ${pull.partnerFansLikeAccount.toFixed(2)}; ${t.name}'s audience scores ${brand} at ${(pull.accountFansLikePartner ?? 0).toFixed(2)} (0 to 1, Qloo).` : "",
    shared.length ? `Shared taste: ${shared.join(", ")}.` : "",
    t.angle ? `Angle: ${t.angle}` : "",
    t.timing ? `Timing: ${t.timing}` : "",
    people.length ? `Verified decision makers: ${people.join("; ")}.` : "",
    draft ? `Drafted first message:\n${draft}` : "",
    `Full evidence: ${SITE}/account/${t.account_slug ?? t.account_id}`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

/** Pushes one workspace's "they need you" list into one connected CRM. */
export async function syncConnection(c: Conn) {
  const crm = PROVIDERS[c.provider];
  if (!crm) throw new Error(`unknown provider ${c.provider}`);
  const [w] = (await sql()`select w.id, w.entity_id, e.name from workspaces w join entities e on e.qloo_id = w.entity_id where w.id = ${c.workspace_id}`) as { id: string; entity_id: string; name: string }[];
  const t = await tokensFor(c, crm);
  const targets = (await sql()`
    select ac.id account_id, ac.slug account_slug, e.name, e.official_site, ac.evidence, p.thesis, p.score, p.band, pl.angle, pl.detail->>'timing' timing
    from accounts ac join entities e on e.qloo_id = ac.entity_id join pairs p on p.id = ac.pair_id
    left join lateral (select angle, detail from plans where account_id = ac.id order by created_at desc limit 1) pl on true
    where ac.passed_on = ${w.entity_id} and p.deal_status in ('clear','past') order by ac.created_at`) as Target[];
  let companies = 0, contacts = 0, notes = 0;
  for (const tg of targets) {
    let companyId = await remembered(c.id, "company", tg.account_id);
    if (!companyId) { companyId = await crm.upsertCompany(t, { name: tg.name, domain: domainOf(tg.official_site) }); await remember(c.id, "company", tg.account_id, companyId); companies++; }
    const people = (await sql()`
      select c.id, c.name, c.role, c.email from contacts c join accounts x on x.id = c.account_id
      where x.entity_id = (select entity_id from accounts where id = ${tg.account_id}) and c.kind = 'person' and c.role_status = 'confirmed' and c.name is not null
      order by c.created_at`) as { id: string; name: string; role: string; email: string | null }[];
    const contactIds: string[] = [];
    for (const p of people) {
      let id = await remembered(c.id, "contact", p.id);
      if (!id) { id = await crm.upsertContact(t, { ...splitName(p.name), title: p.role, email: p.email }, companyId); await remember(c.id, "contact", p.id, id); contacts++; }
      contactIds.push(id);
    }
    if (!(await remembered(c.id, "note", tg.account_id))) {
      const [draft] = (await sql()`
        select t.body from touches t join contacts c on c.id = t.contact_id where c.account_id = ${tg.account_id} and t.step = 1 order by t.created_at limit 1`) as { body: string }[];
      const id = await crm.addNote(t, { title: `SYZYGY: ${tg.name} needs ${w.name}`, body: noteBody(w.name, tg, people.map(p => `${p.name}, ${p.role}`), draft?.body ?? null), companyId, contactIds });
      await remember(c.id, "note", tg.account_id, id); notes++;
    }
  }
  await sql()`update crm_connections set last_sync_at = now(), last_error = null where id = ${c.id}`;
  return { provider: c.provider, workspace: w.name, targets: targets.length, companies, contacts, notes };
}

/** Every connected CRM, one after another. Errors are stored on the connection, not thrown. */
export async function syncAll() {
  const conns = (await sql()`select * from crm_connections order by last_sync_at nulls first`) as Conn[];
  const out = [];
  for (const c of conns) {
    try { out.push(await syncConnection(c)); }
    catch (e) {
      const msg = e instanceof CrmError ? e.message : (e as Error).message;
      await sql()`update crm_connections set last_error = ${msg.slice(0, 500)} where id = ${c.id}`;
      out.push({ provider: c.provider, error: msg.slice(0, 200) });
    }
  }
  return out;
}
