/**
 * Token accounting for context-window usage.
 *
 * This is the single source of truth for turning a step's reported token usage
 * into a "% of the context window used" figure. Both the runtime (telemetry)
 * and the UI (the composer usage gauge) compute usage through here, so the
 * number the user sees is exactly the number later compaction phases will act
 * on. If this drifts, everything downstream drifts with it.
 *
 * Phase 0 only reads it for display; later phases drive budget notices,
 * background compaction, and the hard ceiling off the same thresholds below.
 */

/**
 * Fractions of the context window at which the compaction system changes
 * behaviour. Kept here (not scattered across call sites) so the UI gauge and
 * the runtime triggers share one set of numbers.
 *
 * - `AWARENESS` (25/50/75%): inject a budget notice so the model can pace
 *   itself (Phase 1).
 * - `BACKGROUND_START` (85%): kick off background compaction (Phase 3).
 * - `HARD_CEILING` (95%): usable ceiling; compact/truncate synchronously
 *   before the next model call (Phase 2).
 */
export const CONTEXT_USAGE_AWARENESS_THRESHOLDS = [0.25, 0.5, 0.75] as const
export const CONTEXT_USAGE_BACKGROUND_START = 0.85
export const CONTEXT_USAGE_HARD_CEILING = 0.95

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
