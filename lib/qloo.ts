// Qloo client. Hackathon keys only work on hackathon.api.qloo.com; api.qloo.com returns 401.
// Qloo silently ignores unknown params (empty 200), so every call goes through a whitelist.

const BASE = process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";

export type EntityType =
  | "artist" | "book" | "brand" | "destination" | "movie"
  | "person" | "place" | "podcast" | "tv_show" | "videogame";

export const urn = (t: EntityType) => `urn:entity:${t}`;

const ALLOWED = new Set([
  "query", "types", "take", "page", "entity_ids",
  "filter.type", "filter.entities", "filter.tags", "filter.location.query",
  "filter.start_date", "filter.end_date",
  "signal.interests.entities", "signal.interests.tags",
  "a.signal.interests.entities", "b.signal.interests.entities",
  "feature.explainability",
]);

export class QlooError extends Error {
  constructor(public status: number, public path: string, body: string, public quotaGone = false) {
    super(
      status === 401
        ? `Qloo 401 on ${path}: key rejected. Check QLOO_API_KEY and that the base URL is ${BASE}.`
        : quotaGone
          ? `Qloo monthly quota used up on ${path}; it resets in about ${body}.`
          : `Qloo ${status} on ${path}: ${body.slice(0, 300)}`,
    );
  }
}

/** True for a refusal that retrying won't fix soon: the month's calls are gone, or a 429 survived every retry. */
export const isQuotaError = (e: unknown) => e instanceof QlooError && (e.quotaGone || e.status === 429);

type Params = Record<string, string | number | string[] | undefined>;

export async function qloo<T = unknown>(path: string, params: Params): Promise<T> {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new Error("QLOO_API_KEY is not set");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (!ALLOWED.has(k)) throw new Error(`Qloo param "${k}" is not whitelisted; Qloo would ignore it silently`);
    qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  for (let attempt = 0; ; attempt++) {
    const { status, ok, text, retryAfter, monthLeft, monthReset } = await throttled(async () => {
      const res = await fetch(`${BASE}${path}?${qs}`, {
        headers: { "X-Api-Key": key, accept: "application/json" },
        cache: "no-store",
      });
      return {
        status: res.status, ok: res.ok, text: await res.text(), retryAfter: Number(res.headers.get("retry-after")),
        monthLeft: res.headers.get("x-month-ratelimit-remaining"), monthReset: Number(res.headers.get("x-month-ratelimit-reset")),
      };
    });
    if (ok) return JSON.parse(text) as T;
    // The hackathon key has a monthly allowance (10,000 calls). Once it's gone, retrying only burns the run's time.
    if (status === 429 && monthLeft === "0") throw new QlooError(429, path, `${Math.round(monthReset / 86400)} days`, true);
    if (status === 429 && attempt < 6) {
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw new QlooError(status, path, text);
  }
}

// Qloo publishes no quota and returns 429 under bursts, so calls go out in a narrow, spaced queue.
const MAX_IN_FLIGHT = 2;
const MIN_GAP_MS = 250;
let inFlight = 0;
let lastStart = 0;
const waiting: (() => void)[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function throttled<R>(fn: () => Promise<R>): Promise<R> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>(r => waiting.push(r));
  inFlight++;
  try {
    const gap = lastStart + MIN_GAP_MS - Date.now();
    if (gap > 0) await sleep(gap);
    lastStart = Date.now();
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

export interface QlooEntity {
  entity_id: string;
  name: string;
  types?: string[];
  subtype?: string;
  popularity?: number;
  query?: { affinity?: number; [k: string]: unknown };
  properties?: {
    external?: Record<string, unknown>;
    official_site?: string;
    headquartered?: string;
    industry?: unknown;
    [k: string]: unknown;
  };
  tags?: { id: string; name: string; type?: string }[];
  [k: string]: unknown;
}

interface ResultsEnvelope {
  results?: QlooEntity[] | { entities?: QlooEntity[]; [k: string]: unknown };
  [k: string]: unknown;
}

function entitiesOf(r: ResultsEnvelope): QlooEntity[] {
  if (Array.isArray(r.results)) return r.results;
  return r.results?.entities ?? [];
}

/** Name -> entities. */
export async function search(query: string, type?: EntityType, take = 5) {
  const r = await qloo<ResultsEnvelope>("/search", { query, types: type ? urn(type) : undefined, take });
  return entitiesOf(r);
}

/**
 * Pull: how much the audience of `signal` likes `target`, 0..1.
 * Same-type pairs come back symmetric; cross-type pairs are asymmetric (live test, 2 Oct).
 */
export async function pull(signalIds: string[], targetId: string, targetType: EntityType) {
  const r = await qloo<ResultsEnvelope>("/v2/insights", {
    "filter.type": urn(targetType),
    "signal.interests.entities": signalIds,
    "filter.entities": targetId,
    take: 1,
  });
  const e = entitiesOf(r)[0];
  return e ? { affinity: e.query?.affinity ?? null, popularity: e.popularity ?? null, entity: e } : null;
}

/** Top entities of a type that the signal's audience likes. */
export async function topFor(signalIds: string[], type: EntityType, take = 20) {
  const r = await qloo<ResultsEnvelope>("/v2/insights", {
    "filter.type": urn(type),
    "signal.interests.entities": signalIds,
    take,
  });
  return entitiesOf(r);
}

export async function demographics(signalIds: string[]) {
  return qloo<ResultsEnvelope>("/v2/insights", {
    "filter.type": "urn:demographics",
    "signal.interests.entities": signalIds,
  });
}

export async function heatmap(signalIds: string[], location: string) {
  return qloo<ResultsEnvelope>("/v2/insights", {
    "filter.type": "urn:heatmap",
    "signal.interests.entities": signalIds,
    "filter.location.query": location,
  });
}

/** Needs entity + dates. Brands return nothing (2 Oct); artists and TV do. */
export async function trending(signalIds: string[], type: EntityType, start: string, end: string) {
  return qloo<ResultsEnvelope>("/v2/trending", {
    "filter.type": urn(type),
    "signal.interests.entities": signalIds,
    "filter.start_date": start,
    "filter.end_date": end,
  });
}

/** Tag-based and thin: A24's side came back empty on 2 Oct. */
export async function compare(a: string[], b: string[]) {
  return qloo<ResultsEnvelope>("/v2/analysis/compare", {
    "a.signal.interests.entities": a,
    "b.signal.interests.entities": b,
  });
}

/**
 * Taste tags the signal's AUDIENCE over-indexes on, across every domain.
 * Entity tags don't work for this: brands and artists use different tag vocabularies.
 * Place-utility tags (credit cards, price bands, hotel stars) show up for nearly every audience, so they're dropped.
 */
export async function audienceTags(signalIds: string[], take = 50) {
  const r = await qloo<{ results?: { tags?: { name: string; subtype?: string }[] } }>("/v2/insights", {
    "filter.type": "urn:tag",
    "signal.interests.entities": signalIds,
    take,
  });
  return (r.results?.tags ?? [])
    .filter(t => !(t.subtype ?? "").endsWith(":place"))
    .map(t => t.name.trim().toLowerCase());
}

/** Full records. Insights results omit properties.external (the X / Wikidata ids), so re-fetch here. */
export async function entities(ids: string[]) {
  if (!ids.length) return [];
  return entitiesOf(await qloo<ResultsEnvelope>("/entities", { entity_ids: ids }));
}
