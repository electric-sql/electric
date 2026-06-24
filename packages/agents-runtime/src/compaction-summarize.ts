import { completeSimple } from '@mariozechner/pi-ai'
import { resolvePiModel, toAgentHistory } from './pi-adapter'
import {
  COMPACTION_SUMMARIZATION_PROMPT,
  COMPACTION_SUMMARY_PREFIX,
} from './compaction'
import type { LLMMessage, SummarizeCompleteFn } from './types'

export type { SummarizeCompleteFn }

const DEFAULT_SUMMARY_MAX_TOKENS = 2048

/**
 * Hard deadline for a single summarization request.
 *
 * pi-ai's anthropic provider applies a client-side timeout (and abort) ONLY
 * when the caller passes `timeoutMs`/`signal`, and it never retries. Background
 * compaction fires this call CONCURRENTLY with the agent's own streaming turn on
 * the same (OAuth) token; if that concurrent stream stalls, an unbounded call
 * hangs forever — wedging the pending slot and blocking all future attempts.
 * Bounding it turns a stall into a failure the caller can retry next turn-end.
 */
const DEFAULT_SUMMARY_TIMEOUT_MS = 120_000

/**
 * Summarize a conversation into a compaction handoff summary.
 *
 * Uses the conversation's own model by default: a cheaper, small-window model
 * would overflow on a near-full context — the whole reason we are compacting.
 * The full history is sent followed by Codex's summarization prompt; the summary
 * is prefixed with Codex's preamble so the resuming model knows it's a handoff.
 */
interface SummarizeCoreInput {
  model: string | object
  provider?: string
  apiKey?: string
  maxTokens?: number
  /** Hard deadline for the model call; defaults to {@link DEFAULT_SUMMARY_TIMEOUT_MS}. */
  timeoutMs?: number
  complete?: SummarizeCompleteFn
}

/**
 * Core summarization over already-converted history messages (pi-agent's
 * `AgentMessage[]` shape). Appends Codex's summarization prompt, calls the
 * model, and prefixes the result. Both the LLMMessage path and the mid-turn
 * AgentMessage path funnel through here.
 */
async function summarizeConverted(
  historyMessages: ReadonlyArray<unknown>,
  input: SummarizeCoreInput
): Promise<string> {
  const complete =
    input.complete ?? (completeSimple as unknown as SummarizeCompleteFn)
  const model = resolvePiModel({
    model: input.model as never,
    ...(input.provider && { provider: input.provider as never }),
  })
  const context = {
    messages: [
      ...historyMessages,
      {
        role: `user`,
        content: COMPACTION_SUMMARIZATION_PROMPT,
        timestamp: Date.now(),
      },
    ],
  }

  // Bound the call: pass `timeoutMs`/`signal` (which the anthropic provider
  // honours) AND race against a hard timer, so a stalled stream that ignores the
  // abort still rejects rather than hanging the background slot forever.
  const timeoutMs = input.timeoutMs ?? DEFAULT_SUMMARY_TIMEOUT_MS
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`[compaction] summarize timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  const call = complete(model, context, {
    maxTokens: input.maxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS,
    ...(input.apiKey && { apiKey: input.apiKey }),
    signal: controller.signal,
    timeoutMs,
  })
  // If the timeout wins the race, `call` rejects later (aborted) — swallow it so
  // the loser doesn't surface as an unhandled rejection.
  call.catch(() => {})

  let res: Awaited<ReturnType<SummarizeCompleteFn>>
  try {
    res = await Promise.race([call, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }

  const textBlock = res.content.find((block) => block.type === `text`)
  const text = textBlock && `text` in textBlock ? (textBlock.text ?? ``) : ``
  if (text.trim().length === 0) {
    throw new Error(
      `[compaction] empty summary (stopReason=${res.stopReason ?? `none`} error=${res.errorMessage ?? `none`})`
    )
  }

  return `${COMPACTION_SUMMARY_PREFIX}\n${text}`
}

/**
 * Summarize a conversation (LLMMessage form) into a compaction handoff summary.
 *
 * Uses the conversation's own model by default: a cheaper, small-window model
 * would overflow on a near-full context — the whole reason we are compacting.
 */
export async function summarizeMessages(
  input: SummarizeCoreInput & { messages: ReadonlyArray<LLMMessage> }
): Promise<string> {
  return summarizeConverted(toAgentHistory([...input.messages]), input)
}

/**
 * Summarize already-converted `AgentMessage[]` (what `transformContext` hands
 * us mid-turn) — same as `summarizeMessages` but skips the LLMMessage→Agent
 * conversion since the messages are already in that shape.
 */
export async function summarizeAgentMessages(
  input: SummarizeCoreInput & { messages: ReadonlyArray<unknown> }
): Promise<string> {
  return summarizeConverted(input.messages, input)
}
