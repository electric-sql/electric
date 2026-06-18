import { COMPACTION_CHECKPOINT_NAME } from './compaction'
import type { CompactionStatus } from './compaction'

/** A pi-agent message — loose shape; we only build and slice these. */
export type AgentMessageLike = {
  role: string
  content: unknown
  timestamp?: number
}

export interface MidTurnCompactorDeps {
  /** Summarize the given (older) messages into a handoff summary string. */
  summarize: (messages: Array<AgentMessageLike>) => Promise<string>
  /** Persist the checkpoint lifecycle row (UI marker + future reconstruction). */
  writeCheckpoint: (status: CompactionStatus, content: string) => void
  /** Compaction fires at/above this fraction of the context window. */
  ceiling: number
}

export interface CompactContextInput {
  messages: Array<AgentMessageLike>
  /** Estimated tokens of the outgoing context (real last-step usage + tail). */
  currentTokens: number
  contextWindow: number
}

export type CompactContextFn = (
  input: CompactContextInput
) => Promise<Array<AgentMessageLike> | null>

export function buildCompactionSummaryMessage(
  summary: string
): AgentMessageLike {
  return {
    role: `user`,
    content: [
      {
        type: `text`,
        text: `<${COMPACTION_CHECKPOINT_NAME}>\n${summary}\n</${COMPACTION_CHECKPOINT_NAME}>`,
      },
    ],
    timestamp: Date.now(),
  }
}

/**
 * Build the per-turn mid-turn compaction hook for one agent run. The returned
 * function is wired to pi-agent's `transformContext` — it runs before every
 * model step. Once the estimated outgoing context crosses the ceiling it folds
 * the WHOLE context into a summary and continues from `[summary, ...anything
 * appended since]` (Codex-style — no verbatim pre-compaction tail).
 *
 * Summarizing everything is what keeps the persisted checkpoint sound: the
 * `writeCheckpoint` wiring stamps it with `watermark = timeline head`, and a
 * verbatim tail kept below that head would be dropped on the next turn's
 * reconstruction yet excluded from the summary — silently losing context. By
 * covering everything up to the head, summary and watermark agree.
 *
 * The summary is cached for the rest of the turn: later steps reuse it
 * (returning the compacted view) instead of re-summarizing. Coverage is only
 * extended once new messages appended this turn push back over the ceiling, and
 * a re-summarization chains off the previous summary (prev summary + new
 * middle) rather than re-reading the whole already-summarized bulk.
 *
 * Returns `null` to leave the context untouched (no compaction needed/active).
 */
export function createMidTurnCompactor(
  deps: MidTurnCompactorDeps
): CompactContextFn {
  let state: { summary: string; coveredCount: number } | null = null

  const compactedView = (
    messages: Array<AgentMessageLike>
  ): Array<AgentMessageLike> | null =>
    state
      ? [
          buildCompactionSummaryMessage(state.summary),
          ...messages.slice(state.coveredCount),
        ]
      : null

  return async ({ messages, currentTokens, contextWindow }) => {
    const overCeiling = currentTokens >= deps.ceiling * contextWindow

    // Under the ceiling: keep the compacted view sticky if we already compacted
    // this turn, otherwise leave the context untouched.
    if (!overCeiling) return compactedView(messages)

    // Fold the ENTIRE current context (everything maps to timeline items at or
    // below the head the checkpoint will store), so summary and watermark agree.
    const coveredCount = messages.length

    // Nothing new to fold beyond the existing summary's coverage.
    if (coveredCount <= 0) return compactedView(messages)
    if (state && coveredCount <= state.coveredCount)
      return compactedView(messages)

    // Chain off the previous summary so we don't re-summarize the whole bulk.
    const toSummarize = state
      ? [
          buildCompactionSummaryMessage(state.summary),
          ...messages.slice(state.coveredCount, coveredCount),
        ]
      : messages.slice(0, coveredCount)

    deps.writeCheckpoint(`running`, ``)
    try {
      const summary = await deps.summarize(toSummarize)
      deps.writeCheckpoint(`complete`, summary)
      state = { summary, coveredCount }
      return compactedView(messages)
    } catch {
      deps.writeCheckpoint(`failed`, ``)
      // Fall back to any compaction we already had (or leave untouched).
      return compactedView(messages)
    }
  }
}
