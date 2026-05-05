import { approxTokens, sliceChars } from './token-budget'
import type {
  CacheTier,
  LLMMessage,
  SourceConfig,
  TimestampedMessage,
  UseContextConfig,
} from './types'

const TIER_ORDER: Array<CacheTier> = [
  `pinned`,
  `stable`,
  `slow-changing`,
  `volatile`,
]

export interface SourceSnapshot {
  name: string
  snapshotId: string
  content: string
}

export interface AssembleOverflow {
  source?: string
  scope: `source` | `sourceBudget`
  detail: string
  reason?: `exception` | `type_mismatch`
  errorId?: string
}

export interface AssembleResult {
  messages: Array<TimestampedMessage>
  snapshots: Map<string, SourceSnapshot>
  overflowLog: Array<AssembleOverflow>
}

export type AssembleMessages = Array<TimestampedMessage> & {
  __result?: AssembleResult
}

function makeSnapshotId(name: string): string {
  return `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function ensureTimestamped(
  message: LLMMessage | TimestampedMessage
): TimestampedMessage {
  if (`at` in message) {
    if (!Number.isFinite(message.at)) {
      throw new Error(
        `[agent-runtime] context source returned a timestamped message with non-finite at`
      )
    }
    return message
  }

  return {
    ...message,
    at: 0,
  }
}

function takeMessagesWithinBudget(
  raw: Array<LLMMessage | TimestampedMessage>,
  max: number
): { messages: Array<TimestampedMessage>; tokens: number; truncated: boolean } {
  const messages: Array<TimestampedMessage> = []
  let tokens = 0
  for (const message of raw) {
    const next = ensureTimestamped(message)
    const nextTokens = approxTokens(next.content)
    if (tokens + nextTokens > max) {
      return { messages, tokens, truncated: true }
    }
    tokens += nextTokens
    messages.push(next)
  }
  return { messages, tokens, truncated: false }
}

function takeSourceMessages(
  raw: Array<LLMMessage | TimestampedMessage>,
  source: SourceConfig
): { messages: Array<TimestampedMessage>; tokens: number; truncated: boolean } {
  if (source.max == null) {
    const messages = raw.map((message) => ensureTimestamped(message))
    const tokens = messages.reduce(
      (sum, message) => sum + approxTokens(message.content),
      0
    )
    return { messages, tokens, truncated: false }
  }

  return takeMessagesWithinBudget(raw, source.max)
}

function sourceBudgetMarker(from: number, to: number): TimestampedMessage {
  return {
    role: `user`,
    content: `[truncated stream events offset=${from}..${to} — use load_timeline_range({ from: ${from}, to: ${to} }) to read]`,
    at: 0,
  }
}

function sourceFailureMarker(input: {
  name: string
  reason: `exception` | `type_mismatch`
  errorId: string
}): TimestampedMessage {
  return {
    role: `user`,
    content: `[source_failed name="${input.name}" reason="${input.reason}" error_id="${input.errorId}"]`,
    at: 0,
  }
}

function describeSourceValue(value: unknown): string {
  if (value === null) {
    return `null`
  }
  if (Array.isArray(value)) {
    return `array`
  }
  return typeof value
}

function formatSourceError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function minMax(values: Array<number>): { min: number; max: number } | null {
  if (values.length === 0) {
    return null
  }

  let min = values[0]!
  let max = values[0]!

  for (let index = 1; index < values.length; index++) {
    const value = values[index]!
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
  }

  return { min, max }
}

type SourceContentValue = string | Array<LLMMessage | TimestampedMessage>

async function loadSourceContent(input: {
  name: string
  source: SourceConfig
}): Promise<
  | {
      ok: true
      raw: SourceContentValue
    }
  | {
      ok: false
      marker: TimestampedMessage
      overflow: AssembleOverflow
    }
> {
  try {
    const raw = await input.source.content()
    if (typeof raw === `string` || Array.isArray(raw)) {
      return { ok: true, raw }
    }

    const errorId = crypto.randomUUID()
    return {
      ok: false,
      marker: sourceFailureMarker({
        name: input.name,
        reason: `type_mismatch`,
        errorId,
      }),
      overflow: {
        source: input.name,
        scope: `source`,
        reason: `type_mismatch`,
        errorId,
        detail: `source "${input.name}" returned ${describeSourceValue(raw)}; expected string or array`,
      },
    }
  } catch (error) {
    const errorId = crypto.randomUUID()
    return {
      ok: false,
      marker: sourceFailureMarker({
        name: input.name,
        reason: `exception`,
        errorId,
      }),
      overflow: {
        source: input.name,
        scope: `source`,
        reason: `exception`,
        errorId,
        detail: `source "${input.name}" threw: ${formatSourceError(error)}`,
      },
    }
  }
}

export async function assembleContext(
  config: UseContextConfig,
  opts: { logger?: (entry: AssembleOverflow) => void } = {}
): Promise<AssembleMessages> {
  const tiered: Record<CacheTier, Array<[string, SourceConfig]>> = {
    pinned: [],
    stable: [],
    'slow-changing': [],
    volatile: [],
  }
  for (const [name, source] of Object.entries(config.sources)) {
    tiered[source.cache].push([name, source])
  }

  const messages: Array<TimestampedMessage> = []
  const snapshots = new Map<string, SourceSnapshot>()
  const overflowLog: Array<AssembleOverflow> = []
  let budgetUsed = 0

  for (const tier of TIER_ORDER) {
    if (tier === `volatile`) {
      break
    }

    for (const [name, source] of tiered[tier]) {
      const loaded = await loadSourceContent({ name, source })
      if (!loaded.ok) {
        messages.push(loaded.marker)
        overflowLog.push(loaded.overflow)
        continue
      }
      const { raw } = loaded

      if (typeof raw === `string`) {
        const snapshotId = makeSnapshotId(name)
        snapshots.set(snapshotId, { name, snapshotId, content: raw })

        const sourceTokens = approxTokens(raw)
        const sourceMax = source.max ?? Number.POSITIVE_INFINITY
        if (sourceTokens > sourceMax) {
          const charCap = sourceMax * 4
          const truncated = sliceChars(raw, 0, charCap)
          const marker = `[truncated source "${name}" chars=${charCap}..${raw.length} snapshot=${snapshotId} — use load_source_range({ name: "${name}", from: ${charCap}, to: ${raw.length}, snapshot: "${snapshotId}" }) to read]`
          messages.push({
            role: `user`,
            content: `${truncated}\n${marker}`,
            at: 0,
          })
          overflowLog.push({ source: name, scope: `source`, detail: marker })
          budgetUsed += sourceMax
        } else {
          messages.push({ role: `user`, content: raw, at: 0 })
          budgetUsed += sourceTokens
        }
        continue
      }

      const taken = takeSourceMessages(raw, source)
      for (const message of taken.messages) {
        messages.push({ ...message, at: 0 })
      }
      budgetUsed += taken.tokens
      if (taken.truncated) {
        const detail = `[truncated source "${name}" — ${raw.length - taken.messages.length} messages dropped at per-source max (${source.max} tokens) — use load_timeline_range to recover]`
        messages.push({ role: `user`, content: detail, at: 0 })
        overflowLog.push({ source: name, scope: `source`, detail })
      }
    }
  }

  type VolatileMessage = TimestampedMessage & { __source: string }
  const volatileMessages: Array<VolatileMessage> = []

  for (const [name, source] of tiered.volatile) {
    const loaded = await loadSourceContent({ name, source })
    if (!loaded.ok) {
      messages.push(loaded.marker)
      overflowLog.push(loaded.overflow)
      continue
    }
    const { raw } = loaded

    if (typeof raw === `string`) {
      volatileMessages.push({
        role: `user`,
        content: raw,
        at: 0,
        __source: name,
      })
      continue
    }

    const taken = takeSourceMessages(raw, source)
    for (const message of taken.messages) {
      volatileMessages.push({ ...message, __source: name })
    }
    if (taken.truncated) {
      const detail = `[truncated source "${name}" — ${raw.length - taken.messages.length} messages dropped at per-source max (${source.max} tokens) — use load_timeline_range to recover]`
      messages.push({ role: `user`, content: detail, at: 0 })
      overflowLog.push({ source: name, scope: `source`, detail })
    }
  }

  volatileMessages.sort((left, right) => left.at - right.at)

  const remainingBudget = Math.max(0, config.sourceBudget - budgetUsed)
  const accepted: Array<VolatileMessage> = []
  const droppedOffsets: Array<number> = []
  let volatileBudgetUsed = 0

  for (let i = volatileMessages.length - 1; i >= 0; i--) {
    const message = volatileMessages[i]!
    const nextTokens = approxTokens(message.content)
    if (volatileBudgetUsed + nextTokens > remainingBudget) {
      if (message.role === `tool_call` || message.role === `tool_result`) {
        const stub = `[content truncated — use load_timeline_range({ from: ${message.at}, to: ${message.at} }) to read]`
        const stubTokens = approxTokens(stub)
        if (volatileBudgetUsed + stubTokens <= remainingBudget) {
          volatileBudgetUsed += stubTokens
          accepted.push({ ...message, content: stub })
          continue
        }
      }
      droppedOffsets.push(message.at)
      continue
    }
    volatileBudgetUsed += nextTokens
    accepted.push(message)
  }

  const acceptedCallIds = new Set<string>()
  const acceptedResultIds = new Set<string>()
  for (const m of accepted) {
    const id = (m as VolatileMessage & { toolCallId?: string }).toolCallId
    if (!id) continue
    if (m.role === `tool_call`) acceptedCallIds.add(id)
    else if (m.role === `tool_result`) acceptedResultIds.add(id)
  }
  for (let i = accepted.length - 1; i >= 0; i--) {
    const m = accepted[i]!
    const id = (m as VolatileMessage & { toolCallId?: string }).toolCallId
    if (!id) continue
    if (
      (m.role === `tool_call` && !acceptedResultIds.has(id)) ||
      (m.role === `tool_result` && !acceptedCallIds.has(id))
    ) {
      droppedOffsets.push(m.at)
      accepted.splice(i, 1)
    }
  }

  accepted.reverse()

  if (droppedOffsets.length > 0) {
    const range = minMax(droppedOffsets)!
    const marker = sourceBudgetMarker(range.min, range.max)
    messages.push(marker)
    overflowLog.push({
      scope: `sourceBudget`,
      detail: marker.content,
    })
  }

  for (const message of accepted) {
    const { __source: _source, ...rest } = message
    messages.push(rest)
  }

  for (const entry of overflowLog) {
    opts.logger?.(entry)
  }

  const result: AssembleResult = { messages, snapshots, overflowLog }
  const returned = messages as AssembleMessages
  returned.__result = result
  return returned
}
