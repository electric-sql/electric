/**
 * Token accounting for context-window usage.
 *
 * This is the single source of truth for turning a step's reported token usage
 * into a "% of the context window used" figure. Both the runtime (telemetry +
 * the model-facing budget notice) and the UI (the composer usage gauge) compute
 * usage through here, so the number the user sees is exactly the number later
 * compaction phases will act on. If this drifts, everything downstream drifts
 * with it.
 *
 * Phase 0 reads it for display; Phase 1 surfaces it to the model as a budget
 * notice; later phases drive background compaction and the hard ceiling off the
 * same thresholds below.
 */

import { approxTokens, formatTokenCount } from './token-budget'
import type { LLMMessage } from './types'

/**
 * Fractions of the context window at which the compaction system changes
 * behaviour. Kept here (not scattered across call sites) so the UI gauge and
 * the runtime triggers share one set of numbers.
 *
 * - `AWARENESS` (25/50/75%): inject a budget notice so the model can pace
 *   itself (Phase 1).
 * - `BACKGROUND_START` (85%): kick off background compaction (Phase 3).
 * - `HARD_CEILING` (90%): compact synchronously before the next model call
 *   (Phase 2). Matches Codex's auto-compaction threshold.
 */
export const CONTEXT_USAGE_AWARENESS_THRESHOLDS = [0.25, 0.5, 0.75] as const
export const CONTEXT_USAGE_BACKGROUND_START = 0.85
export const CONTEXT_USAGE_HARD_CEILING = 0.9

export interface ContextUsageInput {
  /**
   * Cache-inclusive prompt size of the most recent request — every token the
   * request occupied in the context window (`input + cacheRead + cacheWrite`).
   * Persisted as `context_input_tokens` on the step.
   */
  contextInputTokens: number
  /**
   * Output tokens of that same step. They re-enter the prompt on the next turn,
   * so counting them makes the gauge reflect how full the window will be going
   * into the next request rather than lagging a turn behind.
   */
  outputTokens?: number
  /** The model's context window (`context_window` on the step). */
  contextWindow: number
}

export interface ContextUsage {
  /** Estimated tokens occupying the window now (input + output of last step). */
  usedTokens: number
  contextWindow: number
  /** `usedTokens / contextWindow`, clamped to [0, 1]. */
  ratio: number
}

/**
 * Compute context-window usage from a step's reported tokens. Returns `null`
 * when the context window is unknown or non-positive (e.g. a provider that
 * didn't report it), so callers can hide the gauge rather than divide by zero.
 */
export function computeContextUsage(
  input: ContextUsageInput
): ContextUsage | null {
  if (!Number.isFinite(input.contextWindow) || input.contextWindow <= 0) {
    return null
  }
  const usedTokens = Math.max(
    0,
    input.contextInputTokens + (input.outputTokens ?? 0)
  )
  const ratio = Math.min(1, usedTokens / input.contextWindow)
  return { usedTokens, contextWindow: input.contextWindow, ratio }
}

export type ContextUsageLevel = `normal` | `warning` | `critical`

/**
 * Severity bucket for a usage ratio, aligned to the compaction thresholds:
 * `warning` once background compaction would start (85%), `critical` at the
 * hard ceiling (95%).
 */
export function contextUsageLevel(ratio: number): ContextUsageLevel {
  if (ratio >= CONTEXT_USAGE_HARD_CEILING) return `critical`
  if (ratio >= CONTEXT_USAGE_BACKGROUND_START) return `warning`
  return `normal`
}

/** Render a usage ratio as a whole-percent label, e.g. `42%`. */
export function formatContextUsagePercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/**
 * Minimal shape of a persisted step row needed to derive context usage — the
 * cache-inclusive prompt size, the step's output, the model window, and `_seq`
 * (the collection's monotonic insertion order) to find the most recent one.
 */
export interface ContextUsageStep {
  _seq?: number
  context_input_tokens?: number
  context_window?: number
  output_tokens?: number
}

/**
 * Pick the most recent step that reported context usage and compute its usage.
 * The latest step of the latest run carries the whole conversation, so its
 * cache-inclusive prompt size is the best estimate of current fullness. Returns
 * `null` when no step has reported usage yet (e.g. the very first turn).
 */
export function selectLatestContextUsage(
  steps: ReadonlyArray<ContextUsageStep>
): ContextUsage | null {
  let latest: ContextUsageStep | null = null
  for (const step of steps) {
    if (
      typeof step.context_window !== `number` ||
      step.context_window <= 0 ||
      typeof step.context_input_tokens !== `number`
    ) {
      continue
    }
    if (!latest || (step._seq ?? 0) > (latest._seq ?? 0)) {
      latest = step
    }
  }
  if (!latest) return null
  return computeContextUsage({
    contextInputTokens: latest.context_input_tokens as number,
    outputTokens: latest.output_tokens,
    contextWindow: latest.context_window as number,
  })
}

/**
 * Whether to show the model a budget notice — once usage reaches the first
 * awareness threshold (25%). Below that the window is empty enough that a
 * reminder is just noise.
 */
export function shouldSurfaceContextBudget(ratio: number): boolean {
  return ratio >= CONTEXT_USAGE_AWARENESS_THRESHOLDS[0]
}

/**
 * The human-readable body of the model-facing budget notice — remaining tokens
 * plus the percentage left. Recomputed every turn from the latest step, so it
 * is always current rather than a stale snapshot from when a threshold was
 * first crossed.
 */
export function formatContextBudgetNotice(usage: ContextUsage): string {
  const remaining = Math.max(0, usage.contextWindow - usage.usedTokens)
  const percentLeft = Math.max(0, Math.round((1 - usage.ratio) * 100))
  return `You have about ${formatTokenCount(
    remaining
  )} tokens (${percentLeft}%) of the context window remaining.`
}

/** Tag wrapping the budget notice, mirroring Codex's `<token_budget>`. */
const CONTEXT_BUDGET_NOTICE_TAG = `token_budget`

/** The model-facing budget notice as a (user-role) message. */
export function buildContextBudgetNotice(usage: ContextUsage): LLMMessage {
  return {
    role: `user`,
    content: `<${CONTEXT_BUDGET_NOTICE_TAG}>\n${formatContextBudgetNotice(
      usage
    )}\n</${CONTEXT_BUDGET_NOTICE_TAG}>`,
  }
}

/**
 * Return `messages` with a current context-budget notice injected, or unchanged
 * when usage is unknown or below the first awareness threshold. The notice is
 * placed just before the final message so the closing turn (and any
 * last-message inspection downstream) is preserved.
 */
export function withContextBudgetNotice(
  messages: ReadonlyArray<LLMMessage>,
  usage: ContextUsage | null
): Array<LLMMessage> {
  if (!usage || !shouldSurfaceContextBudget(usage.ratio)) {
    return [...messages]
  }
  const notice = buildContextBudgetNotice(usage)
  if (messages.length === 0) return [notice]
  return [...messages.slice(0, -1), notice, messages[messages.length - 1]!]
}

/**
 * Default cap on a single tool result's size before it is truncated. One giant
 * tool output (a huge file read, a verbose command) can fill the window on its
 * own; capping each result keeps any single one bounded. Mirrors Codex's
 * per-message truncation.
 */
export const CONTEXT_TOOL_OUTPUT_MAX_TOKENS = 10_000

/**
 * Replace any single `tool_result` whose content exceeds `maxTokens` with a
 * visible placeholder. Truncation is explicit (never silent) and leaves the
 * tool-call pairing intact (`toolCallId` / `isError` are preserved). Other
 * message roles pass through untouched.
 */
export function truncateOversizedToolResults(
  messages: ReadonlyArray<LLMMessage>,
  maxTokens: number = CONTEXT_TOOL_OUTPUT_MAX_TOKENS
): Array<LLMMessage> {
  return messages.map((message) => {
    if (message.role !== `tool_result`) return message
    if (approxTokens(message.content) <= maxTokens) return message
    return {
      ...message,
      content: `[Output truncated: exceeded ${formatTokenCount(
        maxTokens
      )} tokens and was removed to fit the context window]`,
    }
  })
}
