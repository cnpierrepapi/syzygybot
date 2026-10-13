import { generateText } from "ai";
import { createVertex } from "@ai-sdk/google-vertex";

// Gemini on Vertex AI, billed to his Google Cloud credit. Claude on Vertex has zero quota on
// trial accounts (429 on the first call, 13 Oct), and Vercel AI Gateway is on its free tier.
// Flash-Lite for cheap screening and sorting, Flash for strategy and writing.
export const MODELS = {
  fast: "gemini-3.5-flash-lite",
  write: "gemini-3.8-flash",
} as const;

// USD per token. ESTIMATES, not yet checked against the Vertex price sheet. The credit itself is in EUR.
const PRICE: Record<string, { in: number; out: number }> = {
  [MODELS.fast]: { in: 0.0000001, out: 0.0000004 },
  [MODELS.write]: { in: 0.0000005, out: 0.000003 },
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
  const model = MODELS[tier];
  // Gemini 3.x counts hidden reasoning against maxOutputTokens, so the cap gets headroom on top
  // (only tokens actually used are billed), and the writer reasons at "low".
  const r = await generateText({
    model: provider()(model), system, prompt,
    maxOutputTokens: maxOutputTokens + 1024,
    providerOptions: tier === "write" ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined,
  });
  return { text: r.text.trim(), model, costUsd: costUsd(model, r.usage.inputTokens, r.usage.outputTokens) };
}
