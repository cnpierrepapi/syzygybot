// One shape for every CRM, so the sync doesn't care which one a brand uses.

export type Tokens = { access: string; refresh: string | null; expiresAt: number; instanceUrl?: string | null; externalId?: string | null };
export type Company = { name: string; domain: string | null };
export type Person = { first: string; last: string; title: string | null; email: string | null };
export type Note = { title: string; body: string; companyId: string; contactIds: string[] };

export interface Crm {
  id: "hubspot" | "salesforce";
  label: string;
  /** Client id and secret are set, so the connect button can work. */
  configured(): boolean;
  authorizeUrl(state: string, challenge: string, redirectUri: string): string;
  exchange(code: string, verifier: string, redirectUri: string): Promise<Tokens>;
  refresh(t: Tokens): Promise<Tokens>;
  upsertCompany(t: Tokens, c: Company): Promise<string>;
  upsertContact(t: Tokens, p: Person, companyId: string): Promise<string>;
  addNote(t: Tokens, n: Note): Promise<string>;
}

export class CrmError extends Error {
  constructor(public provider: string, public status: number, body: string) {
    super(`${provider} ${status}: ${body.slice(0, 300)}`);
  }
}

/** "Begoña Sanz" → Begoña / Sanz; "Cher" → (blank) / Cher. Every CRM needs a last name. */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: "", last: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export const domainOf = (site: string | null) =>
  site ? site.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] || null : null;
