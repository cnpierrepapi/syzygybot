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
