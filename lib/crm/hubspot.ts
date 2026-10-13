// HubSpot: OAuth with PKCE (token endpoint /oauth/v3/token), CRM v3 objects, HubSpot-defined associations
// (contact→company 279, note→company 190, note→contact 202).
import { CrmError, type Crm, type Tokens } from "./types";

const API = "https://api.hubapi.com";
const SCOPES = ["oauth", "crm.objects.companies.read", "crm.objects.companies.write", "crm.objects.contacts.read", "crm.objects.contacts.write"];
const assoc = (id: string, typeId: number) => ({ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }] });

async function token(params: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${API}/oauth/v3/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.HUBSPOT_CLIENT_ID!, client_secret: process.env.HUBSPOT_CLIENT_SECRET!, ...params }),
  });
  const text = await r.text();
  if (!r.ok) throw new CrmError("hubspot", r.status, text);
  const j = JSON.parse(text) as { access_token: string; refresh_token?: string; expires_in: number; hub_id?: number };
  return { access: j.access_token, refresh: j.refresh_token ?? params.refresh_token ?? null, expiresAt: Date.now() + j.expires_in * 1000, externalId: j.hub_id ? String(j.hub_id) : null };
}

async function call<T>(t: Tokens, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${t.access}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new CrmError("hubspot", r.status, text);
  return JSON.parse(text) as T;
}

async function findOne(t: Tokens, object: string, filters: { propertyName: string; operator: "EQ"; value: string }[]) {
  const j = await call<{ results: { id: string }[] }>(t, `/crm/v3/objects/${object}/search`, { filterGroups: [{ filters }], limit: 1, properties: ["hs_object_id"] });
  return j.results[0]?.id ?? null;
}

export const hubspot: Crm = {
  id: "hubspot",
  label: "HubSpot",
  configured: () => !!process.env.HUBSPOT_CLIENT_ID && !!process.env.HUBSPOT_CLIENT_SECRET,
  authorizeUrl: (state, challenge, redirectUri) =>
    `https://app.hubspot.com/oauth/authorize?${new URLSearchParams({
      client_id: process.env.HUBSPOT_CLIENT_ID!, redirect_uri: redirectUri, scope: SCOPES.join(" "), state,
      code_challenge: challenge, code_challenge_method: "S256",
    })}`,
  exchange: (code, verifier, redirectUri) => token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri }),
  refresh: t => token({ grant_type: "refresh_token", refresh_token: t.refresh ?? "" }),

  async upsertCompany(t, c) {
    const found = c.domain ? await findOne(t, "companies", [{ propertyName: "domain", operator: "EQ", value: c.domain }])
      : await findOne(t, "companies", [{ propertyName: "name", operator: "EQ", value: c.name }]);
    if (found) return found;
    return (await call<{ id: string }>(t, "/crm/v3/objects/companies", { properties: { name: c.name, ...(c.domain ? { domain: c.domain } : {}) } })).id;
  },

  async upsertContact(t, p, companyId) {
    const found = p.email ? await findOne(t, "contacts", [{ propertyName: "email", operator: "EQ", value: p.email }])
      : await findOne(t, "contacts", [{ propertyName: "firstname", operator: "EQ", value: p.first }, { propertyName: "lastname", operator: "EQ", value: p.last }]);
    if (found) return found;
    const properties = { firstname: p.first, lastname: p.last, ...(p.title ? { jobtitle: p.title } : {}), ...(p.email ? { email: p.email } : {}) };
    return (await call<{ id: string }>(t, "/crm/v3/objects/contacts", { properties, associations: [assoc(companyId, 279)] })).id;
  },

  async addNote(t, n) {
    const html = `<p><strong>${esc(n.title)}</strong></p>` + n.body.split(/\n{2,}/).map(par => `<p>${esc(par).replace(/\n/g, "<br>")}</p>`).join("");
    return (await call<{ id: string }>(t, "/crm/v3/objects/notes", {
      properties: { hs_timestamp: new Date().toISOString(), hs_note_body: html },
      associations: [assoc(n.companyId, 190), ...n.contactIds.map(id => assoc(id, 202))],
    })).id;
  },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
