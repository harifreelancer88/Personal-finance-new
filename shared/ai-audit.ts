/** USD nanodollars per token: $0.15 / $0.075 / $0.60 per million. */
export const AI_TOKEN_RATES = { input: 150, cachedInput: 75, output: 600 } as const
export const AI_PRICING_VERSION = 'gpt-4o-mini-standard-2026-10-14'
export interface AiTokenUsage { inputTokens: number; cachedInputTokens: number; outputTokens: number }
export function tokenUsage(value: unknown): AiTokenUsage | null {
  if (!value || typeof value !== 'object') return null
  const usage = value as Record<string, unknown>
  const valid = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 1_000_000_000
  if (!valid(usage.prompt_tokens) || !valid(usage.completion_tokens)) return null
  const details = usage.prompt_tokens_details as { cached_tokens?: unknown } | undefined
  const cached = valid(details?.cached_tokens) ? Math.min(details.cached_tokens, usage.prompt_tokens) : 0
  return { inputTokens: usage.prompt_tokens, cachedInputTokens: cached, outputTokens: usage.completion_tokens }
}
export function tokenCostNanoUsd(usage: AiTokenUsage) {
  return (usage.inputTokens - usage.cachedInputTokens) * AI_TOKEN_RATES.input + usage.cachedInputTokens * AI_TOKEN_RATES.cachedInput + usage.outputTokens * AI_TOKEN_RATES.output
}
export interface AiAuditAttempt {
  id: string; attemptNumber: number; model: string; requestJson: string; responseJson: string | null;
  requestId: string | null; httpStatus: number | null; inputTokens: number | null; cachedInputTokens: number | null;
  outputTokens: number | null; estimatedCostNanoUsd: number | null; pricingVersion: string;
  durationMs: number | null; errorCode: string | null; startedAt: string; completedAt: string | null;
}
export interface AiAuditDetails {
  job: { transactionId: string; description: string; state: string; model: string; categoryName: string | null; keyword: string | null; reason: string | null; inputTokens: number; outputTokens: number; attempts: number; updatedAt: string; errorCode: string | null };
  audits: AiAuditAttempt[];
}
