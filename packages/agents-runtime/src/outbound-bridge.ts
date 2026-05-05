import { entityStateSchema } from './entity-schema'
import type { EntityStreamDB } from './entity-stream-db'
import type { ChangeEvent } from '@durable-streams/state'

interface IdCounters {
  run: number
  step: number
  msg: number
  tc: number
  deltaSeqs: Map<string, number>
}

export interface OutboundIdSeed {
  run: number
  step: number
  msg: number
  tc: number
  cacheKey?: string
}

const outboundIdSeedCache = new Map<string, OutboundIdSeed>()

function nextCounterFromKeys(
  keys: Array<string>,
  prefix: keyof Omit<IdCounters, `deltaSeqs`>
): number {
  let nextCounter = 0

  for (const key of keys) {
    const match = key.match(new RegExp(`^${prefix}-(\\d+)`))
    if (!match) continue
    const nextId = parseInt(match[1]!, 10) + 1
    nextCounter = Math.max(nextCounter, nextId)
  }

  return nextCounter
}

function scanCounters(events: Array<ChangeEvent>): IdCounters {
  const counters: IdCounters = {
    run: 0,
    step: 0,
    msg: 0,
    tc: 0,
    deltaSeqs: new Map(),
  }

  for (const ev of events) {
    if (!ev.key) continue
    const match = ev.key.match(/^(run|step|msg|tc)-(\d+)/)
    if (!match) continue
    const prefix = match[1] as keyof Omit<IdCounters, `deltaSeqs`>
    const nextId = parseInt(match[2]!, 10) + 1
    counters[prefix] = Math.max(counters[prefix], nextId)
  }

  return counters
}

export async function loadOutboundIdSeed(
  db: Pick<EntityStreamDB, `collections`>
): Promise<OutboundIdSeed> {
  const runs = db.collections.runs.toArray
  const steps = db.collections.steps.toArray
  const texts = db.collections.texts.toArray
  const toolCalls = db.collections.toolCalls.toArray

  const runsCollectionId = db.collections.runs.id
  const dbSeed = {
    run: nextCounterFromKeys(
      runs.map((run) => run.key),
      `run`
    ),
    step: nextCounterFromKeys(
      steps.map((step) => step.key),
      `step`
    ),
    msg: nextCounterFromKeys(
      texts.map((text) => text.key),
      `msg`
    ),
    tc: nextCounterFromKeys(
      toolCalls.map((toolCall) => toolCall.key),
      `tc`
    ),
  }
  const cachedSeed = outboundIdSeedCache.get(runsCollectionId)
  const seed: OutboundIdSeed = {
    run: Math.max(dbSeed.run, cachedSeed?.run ?? 0),
    step: Math.max(dbSeed.step, cachedSeed?.step ?? 0),
    msg: Math.max(dbSeed.msg, cachedSeed?.msg ?? 0),
    tc: Math.max(dbSeed.tc, cachedSeed?.tc ?? 0),
    cacheKey: runsCollectionId,
  }
  outboundIdSeedCache.set(runsCollectionId, seed)

  return seed
}

export interface OutboundBridge {
  onRunStart: () => void
  onRunEnd: (opts?: { finishReason?: string }) => void
  onStepStart: (opts?: { modelProvider?: string; modelId?: string }) => void
  onStepEnd: (opts?: {
    finishReason?: string
    tokenInput?: number
    tokenOutput?: number
    durationMs?: number
  }) => void
  onTextStart: () => void
  onTextDelta: (delta: string) => void
  onTextEnd: () => void
  onToolCallStart: (toolCallId: string, name: string, args: unknown) => void
  onToolCallEnd: (
    toolCallId: string,
    name: string,
    result: unknown,
    isError: boolean
  ) => void
}

export function createOutboundBridge(
  existingEvents: Array<ChangeEvent> | OutboundIdSeed,
  writeEvent: (event: ChangeEvent) => void
): OutboundBridge {
  const counters: IdCounters = Array.isArray(existingEvents)
    ? scanCounters(existingEvents)
    : {
        ...existingEvents,
        deltaSeqs: new Map(),
      }
  const cacheKey = Array.isArray(existingEvents)
    ? undefined
    : existingEvents.cacheKey
  const persistSeed = (): void => {
    if (!cacheKey) {
      return
    }
    outboundIdSeedCache.set(cacheKey, {
      run: counters.run,
      step: counters.step,
      msg: counters.msg,
      tc: counters.tc,
      cacheKey,
    })
  }
  let currentRunKey: string | null = null
  let currentStepKey: string | null = null
  let currentStepRunKey: string | null = null
  let currentStepNumber = 0
  let currentMsgKey: string | null = null
  let currentTextRunKey: string | null = null
  const toolCallsById = new Map<
    string,
    { key: string; runKey: string; args: unknown }
  >()
  const requireActiveRun = (action: string): string => {
    if (!currentRunKey) {
      throw new Error(
        `[agent-runtime] ${action} requires an active run. Call onRunStart() first.`
      )
    }
    return currentRunKey
  }

  return {
    onRunStart() {
      currentRunKey = `run-${counters.run++}`
      persistSeed()
      writeEvent(
        entityStateSchema.runs.insert({
          key: currentRunKey,
          value: { status: `started` } as never,
        }) as ChangeEvent
      )
    },

    onRunEnd(opts?: { finishReason?: string }) {
      if (!currentRunKey) return
      const finishReason = opts?.finishReason ?? `stop`
      writeEvent(
        entityStateSchema.runs.update({
          key: currentRunKey,
          value: {
            status: finishReason === `error` ? `failed` : `completed`,
            finish_reason: finishReason,
          } as never,
        }) as ChangeEvent
      )
      currentRunKey = null
    },

    onStepStart(opts?: { modelProvider?: string; modelId?: string }) {
      const runKey = requireActiveRun(`onStepStart`)
      currentStepKey = `step-${counters.step++}`
      persistSeed()
      currentStepRunKey = runKey
      currentStepNumber++
      writeEvent(
        entityStateSchema.steps.insert({
          key: currentStepKey,
          value: {
            step_number: currentStepNumber,
            status: `started`,
            run_id: runKey,
            ...(opts?.modelProvider && { model_provider: opts.modelProvider }),
            ...(opts?.modelId && { model_id: opts.modelId }),
          } as never,
        }) as ChangeEvent
      )
    },

    onStepEnd(opts?: {
      finishReason?: string
      tokenInput?: number
      tokenOutput?: number
      durationMs?: number
    }) {
      if (!currentStepKey) return
      writeEvent(
        entityStateSchema.steps.update({
          key: currentStepKey,
          value: {
            step_number: currentStepNumber,
            status: `completed`,
            run_id: currentStepRunKey,
            finish_reason: opts?.finishReason ?? `stop`,
            ...(opts?.durationMs !== undefined && {
              duration_ms: opts.durationMs,
            }),
          } as never,
        }) as ChangeEvent
      )
    },

    onTextStart() {
      const runKey = requireActiveRun(`onTextStart`)
      currentMsgKey = `msg-${counters.msg++}`
      persistSeed()
      currentTextRunKey = runKey
      counters.deltaSeqs.set(currentMsgKey, 0)
      writeEvent(
        entityStateSchema.texts.insert({
          key: currentMsgKey,
          value: { status: `streaming`, run_id: runKey } as never,
        }) as ChangeEvent
      )
    },

    onTextDelta(delta: string) {
      if (!currentMsgKey) return
      const runKey = requireActiveRun(`onTextDelta`)
      const seq = counters.deltaSeqs.get(currentMsgKey) ?? 0
      counters.deltaSeqs.set(currentMsgKey, seq + 1)
      writeEvent(
        entityStateSchema.textDeltas.insert({
          key: `${currentMsgKey}:${seq}`,
          value: {
            text_id: currentMsgKey,
            run_id: runKey,
            delta,
          } as never,
        }) as ChangeEvent
      )
    },

    onTextEnd() {
      if (!currentMsgKey) return
      writeEvent(
        entityStateSchema.texts.update({
          key: currentMsgKey,
          value: { status: `completed`, run_id: currentTextRunKey } as never,
        }) as ChangeEvent
      )
    },

    onToolCallStart(toolCallId: string, name: string, args: unknown) {
      const runKey = requireActiveRun(`onToolCallStart`)
      const key = `tc-${counters.tc++}`
      persistSeed()
      toolCallsById.set(toolCallId, { key, runKey, args })
      writeEvent(
        entityStateSchema.toolCalls.insert({
          key,
          value: {
            tool_call_id: toolCallId,
            tool_name: name,
            status: `started`,
            args,
            run_id: runKey,
          } as never,
        }) as ChangeEvent
      )
    },

    onToolCallEnd(
      toolCallId: string,
      name: string,
      result: unknown,
      isError: boolean
    ) {
      const toolCall = toolCallsById.get(toolCallId)
      if (!toolCall) return
      writeEvent(
        entityStateSchema.toolCalls.update({
          key: toolCall.key,
          value: {
            tool_call_id: toolCallId,
            tool_name: name,
            status: isError ? `failed` : `completed`,
            args: toolCall.args,
            result:
              typeof result === `string` ? result : JSON.stringify(result),
            run_id: toolCall.runKey,
          } as never,
        }) as ChangeEvent
      )
      toolCallsById.delete(toolCallId)
    },
  }
}
