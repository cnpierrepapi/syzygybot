import { generateText } from "ai";

// Models go through Vercel AI Gateway (plain "provider/model" strings).
// Haiku for cheap screening and sorting, Sonnet for strategy and writing.
export const MODELS = {
  fast: "anthropic/claude-haiku-5.5",
  write: "anthropic/claude-sonnet-5.5",
} as const;

// USD per token, from `vercel ai-gateway models list` on 11 Oct 2026.
const PRICE: Record<string, { in: number; out: number }> = {
  [MODELS.fast]: { in: 0.0000001, out: 0.0000005 },
  [MODELS.write]: { in: 0.000002, out: 0.00001 },
};

export function costUsd(model: string, inputTokens = 0, outputTokens = 0) {
  const p = PRICE[model];
  return p ? inputTokens * p.in + outputTokens * p.out : null;
}


/** One Gateway call; returns the text plus what it cost, so actions can log spend. */
export async function ask(tier: keyof typeof MODELS, system: string, prompt: string, maxOutputTokens = 400) {
  const model = MODELS[tier];
  const r = await generateText({ model, system, prompt, maxOutputTokens });
  return { text: r.text.trim(), model, costUsd: costUsd(model, r.usage.inputTokens, r.usage.outputTokens) };
}
