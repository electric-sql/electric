/**
 * Context compaction.
 *
 * When the conversation approaches the context window, it is summarized into a
 * durable "checkpoint" — a `context_inserted` row tagged `kind: "compaction"` —
 * and the messages it summarizes are dropped from the reconstructed history. The
 * checkpoint carries a watermark: reconstruction hides everything up to it and
 * emits the summary in their place (see `timelineMessages`).
 */

/** `attrs.kind` marking a `context_inserted` row as a compaction checkpoint. */
export const COMPACTION_CHECKPOINT_KIND = `compaction`

/** `name` (and thus the rendered tag) for a compaction checkpoint entry. */
export const COMPACTION_CHECKPOINT_NAME = `compaction_summary`

/** Stable id for the (single, self-superseding) compaction checkpoint entry. */
export const COMPACTION_CHECKPOINT_ID = `compaction`

/**
 * Lifecycle of a compaction checkpoint, carried in `attrs.status`:
 * - `running`  — summarization in flight (UI shows a live "Compacting…" entry)
 * - `complete` — summary ready; acts as the timeline watermark
 * - `failed`   — summarization failed; turn proceeded uncompacted
 */
export type CompactionStatus = `running` | `complete` | `failed`

/**
 * Whether a `context_inserted` row's attrs mark it as a compaction checkpoint
 * (any status).
 */
export function isCompactionCheckpointAttrs(
  attrs: Record<string, string | number | boolean> | undefined
): boolean {
  return attrs?.kind === COMPACTION_CHECKPOINT_KIND
}

/**
 * Whether attrs mark a *completed* compaction checkpoint — the only state that
 * acts as the reconstruction watermark. A `running` (or crashed) checkpoint
 * must never hide history.
 */
export function isCompleteCompactionCheckpointAttrs(
  attrs: Record<string, string | number | boolean> | undefined
): boolean {
  return (
    attrs?.kind === COMPACTION_CHECKPOINT_KIND && attrs?.status === `complete`
  )
}

/**
 * Summarization prompt, reused verbatim from OpenAI Codex. Appended as a user
 * message after the conversation being compacted.
 */
export const COMPACTION_SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`

/**
 * Prefix prepended to the produced summary when it is reinserted as the
 * checkpoint, reused verbatim from Codex.
 */
export const COMPACTION_SUMMARY_PREFIX = `Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:`
