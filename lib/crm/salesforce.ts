// Salesforce: OAuth web-server flow with PKCE against login.salesforce.com (works for any org, including
// sandboxes via SALESFORCE_LOGIN_URL), REST API v62.0. Companies are Accounts, people are Contacts, and
// the evidence lands as a completed Task on the Account (Tasks work in every edition; Notes vary).
import { CrmError, type Crm, type Tokens } from "./types";

const LOGIN = () => process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com";
const V = "v62.0";

async function token(params: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${LOGIN()}/services/oauth2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.SALESFORCE_CLIENT_ID!, client_secret: process.env.SALESFORCE_CLIENT_SECRET!, ...params }),
  });
  const text = await r.text();
  if (!r.ok) throw new CrmError("salesforce", r.status, text);
  const j = JSON.parse(text) as { access_token: string; refresh_token?: string; instance_url: string; id?: string };
  // Salesforce doesn't say when a session ends (it's an org setting); refresh after an hour, or on a 401.
  return { access: j.access_token, refresh: j.refresh_token ?? params.refresh_token ?? null, expiresAt: Date.now() + 60 * 60 * 1000, instanceUrl: j.instance_url, externalId: j.id?.split("/").slice(-2, -1)[0] ?? null };
}

async function call<T>(t: Tokens, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${t.instanceUrl}/services/data/${V}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${t.access}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new CrmError("salesforce", r.status, text);
  return JSON.parse(text) as T;
}

/** SOQL string literal: backslashes and quotes escaped. */
export const soql = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const query = async (t: Tokens, q: string) => (await call<{ records: { Id: string }[] }>(t, `/query?q=${encodeURIComponent(q)}`)).records[0]?.Id ?? null;

export const salesforce: Crm = {
  id: "salesforce",
  label: "Salesforce",
  configured: () => !!process.env.SALESFORCE_CLIENT_ID && !!process.env.SALESFORCE_CLIENT_SECRET,
  authorizeUrl: (state, challenge, redirectUri) =>
    `${LOGIN()}/services/oauth2/authorize?${new URLSearchParams({
      response_type: "code", client_id: process.env.SALESFORCE_CLIENT_ID!, redirect_uri: redirectUri,
      scope: "api refresh_token", state, code_challenge: challenge, code_challenge_method: "S256",
    })}`,
  exchange: (code, verifier, redirectUri) => token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri }),
  refresh: async t => ({ ...(await token({ grant_type: "refresh_token", refresh_token: t.refresh ?? "" })) }),

  async upsertCompany(t, c) {
    const found = c.domain ? await query(t, `SELECT Id FROM Account WHERE Website LIKE ${soql(`%${c.domain}%`)} LIMIT 1`)
      : await query(t, `SELECT Id FROM Account WHERE Name = ${soql(c.name)} LIMIT 1`);
    if (found) return found;
    return (await call<{ id: string }>(t, "/sobjects/Account", { Name: c.name, ...(c.domain ? { Website: c.domain } : {}) })).id;
  },

  async upsertContact(t, p, companyId) {
    const found = p.email ? await query(t, `SELECT Id FROM Contact WHERE Email = ${soql(p.email)} LIMIT 1`)
      : await query(t, `SELECT Id FROM Contact WHERE AccountId = ${soql(companyId)} AND LastName = ${soql(p.last)} AND FirstName = ${soql(p.first)} LIMIT 1`);
    if (found) return found;
    return (await call<{ id: string }>(t, "/sobjects/Contact", {
      FirstName: p.first || undefined, LastName: p.last, AccountId: companyId, ...(p.title ? { Title: p.title } : {}), ...(p.email ? { Email: p.email } : {}),
    })).id;
  },

  async addNote(t, n) {
    return (await call<{ id: string }>(t, "/sobjects/Task", {
      Subject: n.title.slice(0, 255), Description: n.body.slice(0, 32000), WhatId: n.companyId,
      ...(n.contactIds[0] ? { WhoId: n.contactIds[0] } : {}), Status: "Completed", Priority: "Normal",
      ActivityDate: new Date().toISOString().slice(0, 10),
    })).id;
  },
};
