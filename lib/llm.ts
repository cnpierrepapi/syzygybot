import { AsyncLocalStorage } from "node:async_hooks";
import { generateText, stepCountIs, type ToolSet } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";

// Gemini is OFF (27 Oct: Google Search grounding alone cost EUR 182 of the credit; 28 Oct: Google Cloud billing unlinked).
// Nothing opens withGemini() any more, so every call throws GeminiOff before a request leaves. Desks' first runs and new
// business desks run without models (the house writer in lib/desks/housewriter.ts, anchors by theme in lib/live/anchors.ts).
export class GeminiOff extends Error {
  constructor() { super("Gemini is switched off"); this.name = "GeminiOff"; }
}
const gate = new AsyncLocalStorage<string>();
export const geminiOn = () => !!gate.getStore() && process.env.GEMINI_OFF !== "1";
/** Runs f with Gemini allowed. `why` names the reason, for the logs. */
export const withGemini = <T,>(why: string, f: () => Promise<T>) => gate.run(why, f);
const allowed = () => { if (!geminiOn()) throw new GeminiOff(); };

// Gemini on Vertex AI, billed to his Google Cloud credit. Claude on Vertex has zero quota on
// trial accounts (429 on the first call, 13 Oct), and Vercel AI Gateway is on its free tier.
// Picked by the bake-off on real inputs (scripts/model-bakeoff.mts, 23 Oct):
// - fast, screening: 3.5 Flash-Lite got 31 of 31 deal conflicts and reply classes right in about a second.
// - write, research and strategy: 3.5 Flash confirmed the person at 11 of 12 orgs in 33 s (median) with no hung calls;
//   3.8 Flash, used until then, confirmed 6 and hung on 5 of 12.
// - pen, outbound drafts: 4 Argon wrote the best drafts (blind score 4.2 of 5 vs 3.75 for 3.1 Pro) but takes about 75 s,
//   so 3.1 Pro (17 s, never failed) takes over when Argon is slow or busy.
export const MODELS = {
  fast: "gemini-3.5-flash-lite",
  write: "gemini-3.5-flash",
  pen: "gemini-4-argon",
} as const;
// Who takes the call next when a model is busy (429) or hangs past its limit.
const CHAIN: Record<keyof typeof MODELS, string[]> = {
  fast: [MODELS.fast, "gemini-3.1-flash-lite"],
  write: [MODELS.write, MODELS.fast],
  pen: [MODELS.pen, "gemini-3.1-pro-preview", MODELS.write],
};
// A Vertex call can hang on its headers for minutes (seen 21 and 23 Oct): each model gets a limit a little over its slowest
// good answer in the bake-off, so a stuck call moves on instead of holding a card.
const LIMIT_MS = (m: string, search = false) =>
  /argon/.test(m) ? 120_000 : /pro/.test(m) ? 75_000 : /lite/.test(m) ? (search ? 60_000 : 30_000) : search ? 100_000 : 60_000;
const RETRYABLE = /resource exhausted|429|aborted|timeout|overloaded|unavailable|503/i;

// The model bake-off (scripts/model-bakeoff.mts) pins one model per tier, with no fallback, so each is measured on its own.
type Tier = keyof typeof MODELS;
const pinned: Partial<Record<Tier, string>> = {};
export const pinModel = (tier: Tier, model: string | null) => { if (model) pinned[tier] = model; else delete pinned[tier]; };
const chainOf = (tier: Tier) => (pinned[tier] ? [pinned[tier]!] : CHAIN[tier]);
// Thinking at "low" for every model above Flash-Lite (Flash-Lite doesn't take the setting).
const thinks = (m: string) => !/flash-lite/.test(m);
/** Tokens and calls per model in this process, for the bake-off's cost column. */
export const tally = new Map<string, { calls: number; in: number; out: number; searches: number }>();
const count = (m: string, u: { inputTokens?: number; outputTokens?: number }, search = false) => {
  const t = tally.get(m) ?? { calls: 0, in: 0, out: 0, searches: 0 };
  t.calls++; t.in += u.inputTokens ?? 0; t.out += u.outputTokens ?? 0; if (search) t.searches++;
  tally.set(m, t);
};

// USD per token. ESTIMATES, not yet checked against the Vertex price sheet (Argon's isn't published to us; priced as Pro).
// The credit itself is in EUR.
const PRICE: Record<string, { in: number; out: number }> = {
  "gemini-3.5-flash-lite": { in: 0.0000001, out: 0.0000004 },
  "gemini-3.1-flash-lite": { in: 0.0000001, out: 0.0000004 },
  "gemini-3.5-flash": { in: 0.0000005, out: 0.000003 },
  "gemini-3.8-flash": { in: 0.0000005, out: 0.000003 },
  "gemini-3.1-pro-preview": { in: 0.000002, out: 0.000012 },
  "gemini-4-argon": { in: 0.000002, out: 0.000012 },
};

export function costUsd(model: string, inputTokens = 0, outputTokens = 0) {
  const p = PRICE[model];
  return p ? inputTokens * p.in + outputTokens * p.out : null;
}

let vertex: ReturnType<typeof createVertex> | null = null;

function provider() {
  allowed();
  if (vertex) return vertex;
  const b64 = process.env.GOOGLE_VERTEX_CREDENTIALS_B64;
  if (!b64) throw new Error("GOOGLE_VERTEX_CREDENTIALS_B64 is not set");
  vertex = createVertex({
    project: process.env.GOOGLE_VERTEX_PROJECT,
    location: process.env.GOOGLE_VERTEX_LOCATION || "global",
    googleAuthOptions: { credentials: JSON.parse(Buffer.from(b64, "base64").toString("utf8")) },
  });
  return vertex;
}

/** One model call; returns the text plus what it cost, so actions can log spend. */
export async function ask(tier: keyof typeof MODELS, system: string, prompt: string, maxOutputTokens = 400) {
  allowed();
  // Gemini 3.x counts hidden reasoning against maxOutputTokens, so the cap gets headroom on top
  // (only tokens actually used are billed), and the writer reasons at "low".
  const run = (m: string, retries: number) => generateText({
    model: provider()(m), system, prompt, maxRetries: retries, abortSignal: AbortSignal.timeout(LIMIT_MS(m)),
    maxOutputTokens: maxOutputTokens + 1024,
    providerOptions: thinks(m) ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined,
  });
  const chain = chainOf(tier);
  for (const [i, model] of chain.entries()) {
    const last = i === chain.length - 1;
    try {
      const r = await run(model, last ? 2 : 0);
      count(model, r.usage);
      return { text: r.text.trim(), model, costUsd: costUsd(model, r.usage.inputTokens, r.usage.outputTokens), usage: r.usage };
    } catch (e) {
      // Busy or stuck: the next model down takes the call instead of the run failing.
      if (last || !RETRYABLE.test(String((e as Error).message))) throw e;
    }
  }
  throw new Error("no model answered");
}

/** A model call that may call our own tools (e.g. live Qloo queries) for up to `steps` rounds. */
export async function askTools(system: string, prompt: string, tools: ToolSet, steps = 6, maxOutputTokens = 600) {
  allowed();
  const model = chainOf("write")[0];
  const r = await generateText({
    model: provider()(model), system, prompt, tools, stopWhen: stepCountIs(steps),
    maxOutputTokens: maxOutputTokens + 1024,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
  });
  return { text: r.text.trim(), model, costUsd: costUsd(model, r.totalUsage.inputTokens, r.totalUsage.outputTokens) };
}

// Google Search grounding, billed per search on top of tokens. ESTIMATE per call, not checked.
const SEARCH_USD = 0.014;

export type WebSource = { url: string; title: string };

/** A model call that can search Google. Returns the text plus the search results it read. */
export async function askWeb(prompt: string, system: string, maxOutputTokens = 1500) {
  allowed();
  const v = provider();
  // Each model has its own search-grounding quota: when one is busy (429) or stuck, the next searches instead.
  const run = (model: string, retries: number) => generateText({
    model: v(model), system, prompt, maxRetries: retries, abortSignal: AbortSignal.timeout(LIMIT_MS(model, true)),
    // Cast: the Vertex package and ai resolve different provider-utils versions; fine at runtime.
    tools: { google_search: v.tools.googleSearch({}) } as unknown as ToolSet,
    maxOutputTokens: maxOutputTokens + 1024,
    providerOptions: thinks(model) ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined,
  });
  const chain = chainOf("write");
  for (const [i, model] of chain.entries()) {
    const last = i === chain.length - 1;
    let r: Awaited<ReturnType<typeof run>>;
    try { r = await run(model, last ? 2 : 0); }
    catch (e) { if (last || !RETRYABLE.test(String((e as Error).message))) throw e; continue; }
    count(model, r.usage, true);
    const sources: WebSource[] = (r.sources ?? [])
      .filter((s): s is typeof s & { url: string } => s.sourceType === "url")
      .map(s => ({ url: s.url, title: s.title ?? "" }));
    const tokens = costUsd(model, r.usage.inputTokens, r.usage.outputTokens) ?? 0;
    const gm = (r.providerMetadata as { vertex?: { groundingMetadata?: { webSearchQueries?: string[] } } } | undefined)?.vertex?.groundingMetadata;
    return { text: r.text.trim(), sources, queries: gm?.webSearchQueries ?? [], model, costUsd: tokens + SEARCH_USD, usage: r.usage };
  }
  throw new Error("no model answered");
}

/** Pulls the first JSON object out of a model reply (fenced or bare). */
export function parseJson<T>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const raw = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(raw) as T; } catch { return null; }
}
