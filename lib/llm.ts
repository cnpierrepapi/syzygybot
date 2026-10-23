import { generateText, stepCountIs, type ToolSet } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";

// Gemini on Vertex AI, billed to his Google Cloud credit. Claude on Vertex has zero quota on
// trial accounts (429 on the first call, 13 Oct), and Vercel AI Gateway is on its free tier.
// Flash-Lite for cheap screening and sorting, Flash for strategy and research, Pro for the messages that go out (Flash's
// drafts read like form letters, 23 Oct). 3.1 Pro Preview is the newest Pro this project can call.
export const MODELS = {
  fast: "gemini-3.5-flash-lite",
  write: "gemini-3.8-flash",
  pen: "gemini-3.1-pro-preview",
} as const;
// Who takes a call when a model's quota is used up or it hangs: a draft falls to Flash, never to Flash-Lite.
const FALLBACK: Partial<Record<keyof typeof MODELS, keyof typeof MODELS>> = { pen: "write", write: "fast" };

// USD per token. ESTIMATES, not yet checked against the Vertex price sheet. The credit itself is in EUR.
const PRICE: Record<string, { in: number; out: number }> = {
  [MODELS.fast]: { in: 0.0000001, out: 0.0000004 },
  [MODELS.write]: { in: 0.0000005, out: 0.000003 },
  [MODELS.pen]: { in: 0.000002, out: 0.000012 },
};

export function costUsd(model: string, inputTokens = 0, outputTokens = 0) {
  const p = PRICE[model];
  return p ? inputTokens * p.in + outputTokens * p.out : null;
}

let vertex: ReturnType<typeof createVertex> | null = null;

function provider() {
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
  // Gemini 3.x counts hidden reasoning against maxOutputTokens, so the cap gets headroom on top
  // (only tokens actually used are billed), and the writer reasons at "low".
  // A Vertex call can hang on its headers for minutes (seen 21 and 23 Oct), so every call has a hard limit.
  const run = (m: string, retries: number) => generateText({
    model: provider()(m), system, prompt, maxRetries: retries, abortSignal: AbortSignal.timeout(90_000),
    maxOutputTokens: maxOutputTokens + 1024,
    providerOptions: m === MODELS.write || m === MODELS.pen ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined,
  });
  let model: string = MODELS[tier];
  // When a model's quota is used up (429) or it hangs past the limit, the next one down takes the call instead of the run failing.
  const next = FALLBACK[tier];
  const r = await run(model, next ? 1 : 2).catch(e => {
    if (!next || !/resource exhausted|429|aborted|timeout/i.test(String((e as Error).message))) throw e;
    model = MODELS[next];
    return run(model, 2);
  });
  return { text: r.text.trim(), model, costUsd: costUsd(model, r.usage.inputTokens, r.usage.outputTokens) };
}

/** A model call that may call our own tools (e.g. live Qloo queries) for up to `steps` rounds. */
export async function askTools(system: string, prompt: string, tools: ToolSet, steps = 6, maxOutputTokens = 600) {
  const model = MODELS.write;
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
  const v = provider();
  // Each model has its own search-grounding quota: when the writer's is used up (429), the fast model searches instead.
  const run = (model: string, retries: number) => generateText({
    model: v(model), system, prompt, maxRetries: retries, abortSignal: AbortSignal.timeout(120_000),
    // Cast: the Vertex package and ai resolve different provider-utils versions; fine at runtime.
    tools: { google_search: v.tools.googleSearch({}) } as unknown as ToolSet,
    maxOutputTokens: maxOutputTokens + 1024,
    providerOptions: model === MODELS.write ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined,
  });
  let model: string = MODELS.write;
  const r = await run(model, 1).catch(e => {
    if (!/resource exhausted|429/i.test(String((e as Error).message))) throw e;
    model = MODELS.fast;
    return run(model, 2);
  });
  const sources: WebSource[] = (r.sources ?? [])
    .filter((s): s is typeof s & { url: string } => s.sourceType === "url")
    .map(s => ({ url: s.url, title: s.title ?? "" }));
  const tokens = costUsd(model, r.usage.inputTokens, r.usage.outputTokens) ?? 0;
  const gm = (r.providerMetadata as { vertex?: { groundingMetadata?: { webSearchQueries?: string[] } } } | undefined)?.vertex?.groundingMetadata;
  return { text: r.text.trim(), sources, queries: gm?.webSearchQueries ?? [], model, costUsd: tokens + SEARCH_USD };
}

/** Pulls the first JSON object out of a model reply (fenced or bare). */
export function parseJson<T>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const raw = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(raw) as T; } catch { return null; }
}
