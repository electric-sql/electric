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
 * Summarize a conversation into a compaction handoff summary.
 *
 * Uses the **conversation's own model** by default (RFC Q2): a cheaper,
 * small-window model would overflow on a near-full context — the whole reason
 * we are compacting. The full history is sent followed by Codex's summarization
 * prompt; the returned summary is prefixed with Codex's summary preamble so the
 * resuming model knows it is reading a handoff.
 */
interface SummarizeCoreInput {
  model: string | object
  provider?: string
  apiKey?: string
  maxTokens?: number
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

  const res = await complete(model, context, {
    maxTokens: input.maxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS,
    ...(input.apiKey && { apiKey: input.apiKey }),
  })

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
 * Uses the **conversation's own model** by default (RFC Q2): a cheaper,
 * small-window model would overflow on a near-full context — the whole reason
 * we are compacting.
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
