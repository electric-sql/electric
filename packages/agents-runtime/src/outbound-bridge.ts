import { entityStateSchema } from './entity-schema'
import type { EntityStreamDB } from './entity-stream-db'
import type { ChangeEvent } from '@durable-streams/state'

interface IdCounters {
  run: number
  step: number
  msg: number
  tc: number
  reasoning: number
  deltaSeqs: Map<string, number>
}

export interface OutboundIdSeed {
  run: number
  step: number
  msg: number
  tc: number
  reasoning: number
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
    reasoning: 0,
    deltaSeqs: new Map(),
  }

  for (const ev of events) {
    if (!ev.key) continue
    const match = ev.key.match(/^(run|step|msg|tc|reasoning)-(\d+)/)
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
  const reasoning = db.collections.reasoning.toArray

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
    reasoning: nextCounterFromKeys(
      reasoning.map((r) => r.key),
      `reasoning`
    ),
  }
  const cachedSeed = outboundIdSeedCache.get(runsCollectionId)
  const seed: OutboundIdSeed = {
    run: Math.max(dbSeed.run, cachedSeed?.run ?? 0),
    step: Math.max(dbSeed.step, cachedSeed?.step ?? 0),
    msg: Math.max(dbSeed.msg, cachedSeed?.msg ?? 0),
    tc: Math.max(dbSeed.tc, cachedSeed?.tc ?? 0),
    reasoning: Math.max(dbSeed.reasoning, cachedSeed?.reasoning ?? 0),
    cacheKey: runsCollectionId,
  }
  outboundIdSeedCache.set(runsCollectionId, seed)

  return seed
}

/**
 * Synchronously allocate the next `run-N` key, coordinated with the
 * outbound bridge's id-seed cache. Writers like `ctx.recordRun()` and
 * `ctx.replyText()` emit run rows via `writeEvent`, which has no
 * synchronous local apply — the collection only catches up when the
 * event round-trips, so seeding a counter from `runs.toArray` alone can
 * reuse a key the bridge just allocated. Consulting (and advancing) the
 * shared cache keeps all allocators collision-free within the process.
 */
export function allocateRunKey(
  db: Pick<EntityStreamDB, `collections`>,
  floor = 0
): string {
  const cacheKey = db.collections.runs.id
  const fromDb = nextCounterFromKeys(
    db.collections.runs.toArray.map((run) => run.key),
    `run`
  )
  // Without a stable collection id the shared cache would cross-contaminate
  // unrelated DBs (e.g. test fixtures); rely on the caller's floor instead.
  const cached = cacheKey ? outboundIdSeedCache.get(cacheKey) : undefined
  const next = Math.max(fromDb, cached?.run ?? 0, floor)
  if (cacheKey) {
    outboundIdSeedCache.set(cacheKey, {
      run: next + 1,
      step: cached?.step ?? 0,
      msg: cached?.msg ?? 0,
      tc: cached?.tc ?? 0,
      reasoning: cached?.reasoning ?? 0,
      cacheKey,
    })
  }
  return `run-${next}`
}

export interface OutboundBridge {
  onRunStart: () => void
  onRunEnd: (opts?: { finishReason?: string }) => void
  onError: (opts: { errorCode: string; message: string }) => void
  onStepStart: (opts?: { modelProvider?: string; modelId?: string }) => void
  onStepEnd: (opts?: {
    finishReason?: string
    // Uncached input side only (fresh prompt tokens + cache writes;
    // prompt-cache *reads* excluded) — the cache-inclusive total would
    // re-count the whole conversation on every warm-cache step.
    tokenInput?: number
    // Uncached portion of the input side (no cacheRead/cacheWrite). Not
    // persisted to the step row — forwarded to hooks for budget accounting.
    tokenInputUncached?: number
    tokenOutput?: number
    durationMs?: number
  }) => void
  onTextStart: () => void
  onTextDelta: (delta: string) => void
  onTextEnd: () => void
  // Reasoning / extended-thinking stream. Mirrors the text path:
  // start opens a row, delta(s) append to a paired `reasoningDeltas`
  // collection, end closes the row.
  //
  // `opts.encrypted` on end handles Anthropic's `redacted_thinking`
  // content blocks — opaque payloads the client can't display but
  // must round-trip back to the model verbatim on the next turn or
  // the conversation errors. Persist as-is, render nothing.
  //
  // `opts.summaryTitle` (currently OpenAI Responses only — emitted
  // as a bolded first line `**Inspecting PR workflow**\n\n<body>`)
  // is extracted at write time so the UI can drive a separate
  // heading without re-parsing on every render. Skip for providers
  // that don't emit titles (Anthropic, DeepSeek-R1, Moonshot K2).
  onReasoningStart: () => void
  onReasoningDelta: (delta: string) => void
  onReasoningEnd: (opts?: { encrypted?: string; summaryTitle?: string }) => void
  onToolCallStart(toolCallId: string, name: string, args: unknown): void
  onToolCallStart(name: string, args: unknown): void
  onToolCallEnd(
    toolCallId: string,
    name: string,
    result: unknown,
    isError: boolean
  ): void
  onToolCallEnd(name: string, result: unknown, isError: boolean): void
}

export interface OutboundBridgeHooks {
  /**
   * Called after a step ends and has been written to the entity stream.
   * Receives the token counts (zero if the provider did not report them):
   * `input` is the full prompt volume the model saw (including prompt-cache
   * reads — what the meta row displays), `uncachedInput` is the new input
   * this step only (fresh tokens plus cache writes; cache *reads* excluded),
   * `output` is completion tokens. Budget accounting should use
   * `uncachedInput + output` so warm-cache turns don't re-count the entire
   * conversation every step.
   */
  onStepEnd?: (stats: {
    input: number
    uncachedInput: number
    output: number
  }) => void
}

export function createOutboundBridge(
  existingEvents: Array<ChangeEvent> | OutboundIdSeed,
  writeEvent: (event: ChangeEvent) => void,
  hooks?: OutboundBridgeHooks
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
      reasoning: counters.reasoning,
      cacheKey,
    })
  }
  let currentRunKey: string | null = null
  let currentStepKey: string | null = null
  let currentStepRunKey: string | null = null
  let currentStepNumber = 0
  let currentMsgKey: string | null = null
  let currentTextRunKey: string | null = null
  let currentReasoningKey: string | null = null
  let currentReasoningRunKey: string | null = null
  const toolCallsById = new Map<
    string,
    { key: string; runKey: string; args: unknown }
  >()
  const legacyToolCallIdsByName = new Map<string, Array<string>>()
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

    onError(opts: { errorCode: string; message: string }) {
      if (!currentRunKey) return
      writeEvent(
        entityStateSchema.errors.insert({
          key: `${currentRunKey}:error-${crypto.randomUUID()}`,
          value: {
            error_code: opts.errorCode,
            message: opts.message,
            run_id: currentRunKey,
            ...(currentStepKey ? { step_id: currentStepKey } : {}),
          } as never,
        }) as ChangeEvent
      )
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
      tokenInputUncached?: number
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
            ...(opts?.tokenInput !== undefined && {
              input_tokens: opts.tokenInput,
            }),
            ...(opts?.tokenOutput !== undefined && {
              output_tokens: opts.tokenOutput,
            }),
          } as never,
        }) as ChangeEvent
      )
      hooks?.onStepEnd?.({
        input: opts?.tokenInput ?? 0,
        uncachedInput: opts?.tokenInputUncached ?? opts?.tokenInput ?? 0,
        output: opts?.tokenOutput ?? 0,
      })
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

    onReasoningStart() {
      const runKey = requireActiveRun(`onReasoningStart`)
      currentReasoningKey = `reasoning-${counters.reasoning++}`
      persistSeed()
      currentReasoningRunKey = runKey
      counters.deltaSeqs.set(currentReasoningKey, 0)
      writeEvent(
        entityStateSchema.reasoning.insert({
          key: currentReasoningKey,
          value: { status: `streaming`, run_id: runKey } as never,
        }) as ChangeEvent
      )
    },

    onReasoningDelta(delta: string) {
      if (!currentReasoningKey) return
      const runKey = requireActiveRun(`onReasoningDelta`)
      const seq = counters.deltaSeqs.get(currentReasoningKey) ?? 0
      counters.deltaSeqs.set(currentReasoningKey, seq + 1)
      writeEvent(
        entityStateSchema.reasoningDeltas.insert({
          key: `${currentReasoningKey}:${seq}`,
          value: {
            reasoning_id: currentReasoningKey,
            run_id: runKey,
            delta,
          } as never,
        }) as ChangeEvent
      )
    },

    onReasoningEnd(opts?: { encrypted?: string; summaryTitle?: string }) {
      if (!currentReasoningKey) return
      writeEvent(
        entityStateSchema.reasoning.update({
          key: currentReasoningKey,
          value: {
            status: `completed`,
            run_id: currentReasoningRunKey,
            ...(opts?.encrypted !== undefined && { encrypted: opts.encrypted }),
            ...(opts?.summaryTitle !== undefined && {
              summary_title: opts.summaryTitle,
            }),
          } as never,
        }) as ChangeEvent
      )
      currentReasoningKey = null
      currentReasoningRunKey = null
    },

    onToolCallStart(
      toolCallIdOrName: string,
      nameOrArgs: string | unknown,
      maybeArgs?: unknown
    ) {
      const runKey = requireActiveRun(`onToolCallStart`)
      const key = `tc-${counters.tc++}`
      const legacyCall = maybeArgs === undefined
      const toolCallId = legacyCall ? key : toolCallIdOrName
      const name = legacyCall ? toolCallIdOrName : (nameOrArgs as string)
      const args = legacyCall ? nameOrArgs : maybeArgs
      if (legacyCall) {
        const ids = legacyToolCallIdsByName.get(name) ?? []
        ids.push(toolCallId)
        legacyToolCallIdsByName.set(name, ids)
      }
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
      toolCallIdOrName: string,
      nameOrResult: string | unknown,
      resultOrIsError: unknown,
      maybeIsError?: boolean
    ) {
      const legacyCall = maybeIsError === undefined
      const name = legacyCall ? toolCallIdOrName : (nameOrResult as string)
      const result = legacyCall ? nameOrResult : resultOrIsError
      const isError = legacyCall
        ? Boolean(resultOrIsError)
        : Boolean(maybeIsError)
      const toolCallId = legacyCall
        ? (legacyToolCallIdsByName.get(name)?.shift() ?? ``)
        : toolCallIdOrName
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
