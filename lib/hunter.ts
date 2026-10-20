// Hunter guard. The free plan has 50 searches a month (resets 19 Nov), so every paid call is fenced:
// a free GET /v2/account first, a reserve that is never spent, a hard cap per run, and every call logged in hunter_calls.
// Only the Email Finder is used, for a named person already verified in the role. Its answer counts only with Hunter's
// own public sources and a "valid" verification; anything else is dropped, and a personal address is never guessed.
import { sql } from "./db";
import { logAction } from "./actions";

const API = "https://api.hunter.io/v2";
export const RESERVE = 10;   // searches always left untouched
export const RUN_CAP = 8;    // searches one run may spend

const key = () => { const k = process.env.HUNTER_API_KEY; if (!k) throw new Error("HUNTER_API_KEY not set"); return k; };

/** Searches left this month. Free call. */
export async function searchesLeft() {
  const r = await fetch(`${API}/account?api_key=${key()}`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({})) as any;
  if (!r.ok) throw new Error(`Hunter account ${r.status}`);
  // Older plans report searches; credit plans report credits. Either way: available minus used.
  const q = j?.data?.requests?.searches ?? j?.data?.requests?.credits;
  if (!q || typeof q.available !== "number") throw new Error("Hunter account: unknown quota shape");
  return { left: q.available - (q.used ?? 0), used: q.used ?? 0, available: q.available, resets: j?.data?.reset_date ?? null };
}

export type Found = { email: string; score: number; sources: string[]; status: string };

/** One Email Finder search, only if the reserve allows it. Returns null when refused or not found. */
export async function findEmail(domain: string, first: string, last: string, budget: { spent: number }) {
  if (budget.spent >= RUN_CAP) return { refused: `run cap of ${RUN_CAP} reached` as const };
  const q = await searchesLeft();
  if (q.left <= RESERVE) return { refused: `only ${q.left} searches left, reserve is ${RESERVE}` as const };
  const r = await fetch(`${API}/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}&api_key=${key()}`,
    { signal: AbortSignal.timeout(30000) });
  budget.spent++;
  const j = await r.json().catch(() => ({})) as any;
  const d = j?.data ?? {};
  const found: Found | null = d.email ? {
    email: String(d.email).toLowerCase(), score: d.score ?? 0,
    sources: (d.sources ?? []).map((s: { uri?: string }) => s.uri).filter(Boolean).slice(0, 5), status: d.verification?.status ?? "unknown",
  } : null;
  await sql()`insert into hunter_calls (endpoint, query, left_before, result)
    values ('email-finder', ${JSON.stringify({ domain, first, last })}, ${q.left}, ${JSON.stringify({ http: r.status, found })})`;
  await logAction({ agent: "contact_finder", kind: "hunter.search",
    summary: `Asked Hunter for one verified work address at ${domain}: ${found ? (usable(found) ? "found, with public sources" : "found but not usable") : "none"}. ${q.left - 1} searches left this month.`,
    detail: { left: q.left - 1 } });
  return { found };
}

/** A Hunter answer we may use: Hunter verified it and can point to public pages that show it. */
export const usable = (f: Found | null): f is Found => !!f && f.status === "valid" && f.sources.length > 0;
