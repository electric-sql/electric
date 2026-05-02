import { queryOnce } from '@durable-streams/state'
import { assembleContext } from './context-assembly'
import { createContextEntriesApi } from './context-entries'
import { entityStateSchema } from './entity-schema'
import { createOutboundBridge, loadOutboundIdSeed } from './outbound-bridge'
import { createPiAgentAdapter } from './pi-adapter'
import {
  timelineMessages as runtimeTimelineMessages,
  timelineToMessages,
} from './timeline-context'
import { getCronStreamPath } from './cron-utils'
import { runtimeLog } from './log'
import { sliceChars } from './token-budget'
import { createContextTools } from './tools/context-tools'
import { CACHE_TIERS } from './types'
import { entity as entityObservationSource } from './observation-sources'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  AgentConfig,
  AgentHandle,
  AgentModel,
  AgentRunResult,
  AgentTool,
  CodingAgentHandle,
  CodingAgentKind,
  CodingAgentRunSummary,
  CodingAgentState,
  EntityHandle,
  EntityStreamDBWithActions,
  HandlerContext,
  LLMMessage,
  ObservationHandle,
  ObservationSource,
  RunHandle,
  SharedStateHandle,
  SharedStateSchemaMap,
  SpawnCodingAgentOptions,
  StateProxy,
  TimelineProjectionOpts,
  UseContextConfig,
  Wake,
  WakeEvent,
  WakeSession,
} from './types'

function agentModelId(model: AgentModel): string {
  return typeof model === `string` ? model : model.id
}

function agentModelProvider(config: AgentConfig): string {
  return typeof config.model === `string`
    ? (config.provider ?? `anthropic`)
    : config.model.provider
}

export interface HandlerContextConfig<TState extends StateProxy = StateProxy> {
  entityUrl: string
  entityType: string
  epoch: number
  wakeOffset: string
  firstWake: boolean
  tags: Readonly<Record<string, string>>
  args: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  state: TState
  actions: Record<string, (...args: Array<unknown>) => unknown>
  electricTools: Array<AgentTool>
  events: Array<ChangeEvent>
  writeEvent: (event: ChangeEvent) => void
  wakeSession: WakeSession
  wakeEvent: WakeEvent
  doObserve: (
    source: ObservationSource,
    wake?: Wake
  ) => Promise<ObservationHandle>
  doSpawn: (
    type: string,
    id: string,
    args?: Record<string, unknown>,
    opts?: {
      initialMessage?: unknown
      wake?: Wake
      tags?: Record<string, string>
      observe?: boolean
    }
  ) => Promise<EntityHandle>
  doMkdb: <TSchema extends SharedStateSchemaMap>(
    id: string,
    schema: TSchema
  ) => SharedStateHandle<TSchema>
  prepareAgentRun?: () => Promise<void>
  executeSend: (send: {
    targetUrl: string
    payload: unknown
    type?: string
    afterMs?: number
  }) => void
  doSetTag: (key: string, value: string) => Promise<void>
  doRemoveTag: (key: string) => Promise<void>
}

export interface HandlerContextResult<TState extends StateProxy = StateProxy> {
  ctx: HandlerContext<TState>
  getSleepRequested: () => boolean
}

type DebugHandlerContext<TState extends StateProxy = StateProxy> =
  HandlerContext<TState> & {
    __debug: {
      useContextRegistrations: () => number
    }
  }

function asMessageText(value: unknown): string {
  return typeof value === `string` ? value : JSON.stringify(value ?? ``)
}

function missingContextToolData(message: string): Promise<never> {
  return Promise.reject(new Error(message))
}

function getCronScheduleTriggerPayload(
  db: Pick<EntityStreamDBWithActions, `collections`>,
  sourceUrl: string
): unknown | undefined {
  for (const entry of db.collections.manifests.toArray) {
    const manifest = entry as Record<string, unknown>
    if (
      manifest.kind !== `schedule` ||
      manifest.scheduleType !== `cron` ||
      typeof manifest.expression !== `string`
    ) {
      continue
    }

    const manifestSource = getCronStreamPath(
      manifest.expression,
      typeof manifest.timezone === `string` ? manifest.timezone : undefined,
      { fallback: `utc` }
    )
    if (manifestSource !== sourceUrl) {
      continue
    }

    if (`payload` in manifest) {
      return manifest.payload
    }
  }

  return undefined
}

function getTriggerMessageText(
  db: Pick<EntityStreamDBWithActions, `collections`>,
  wakeEvent: WakeEvent,
  events: Array<ChangeEvent>,
  wakeOffset: string
): string {
  if (wakeEvent.type === `message_received`) {
    let latestPayload: unknown = wakeEvent.payload
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]!
      if (event.type !== `message_received`) {
        continue
      }

      const payload = (event.value as { payload?: unknown } | undefined)
        ?.payload
      if (latestPayload === undefined) {
        latestPayload = payload
      }
      if (wakeOffset === `-1` || event.headers.offset === wakeOffset) {
        return asMessageText(payload)
      }
    }

    if (latestPayload !== undefined) {
      return asMessageText(latestPayload)
    }
  }

  if (wakeEvent.type === `wake` && typeof wakeEvent.source === `string`) {
    const cronPayload = getCronScheduleTriggerPayload(db, wakeEvent.source)
    if (cronPayload !== undefined) {
      return asMessageText(cronPayload)
    }
  }

  return asMessageText({
    type: wakeEvent.type,
    source: wakeEvent.source,
    payload: wakeEvent.payload,
    summary: wakeEvent.summary,
    fullRef: wakeEvent.fullRef,
    fromOffset: wakeEvent.fromOffset,
    toOffset: wakeEvent.toOffset,
    eventCount: wakeEvent.eventCount,
  })
}

export function createHandlerContext<TState extends StateProxy = StateProxy>(
  config: HandlerContextConfig<TState>
): HandlerContextResult<TState> {
  let sleepRequested = false
  let agentConfig: AgentConfig | null = null
  let useContextConfig: UseContextConfig | null = null
  let useContextHash = ``
  let useContextRegistrations = 0
  // Lazy-loaded run-id counter used by ctx.recordRun(). Initialized
  // from the runs already present in the entity's StreamDB so keys
  // remain monotonic across handler invocations.
  let recordRunCounter: number | null = null
  const nextRunKey = (): string => {
    if (recordRunCounter == null) {
      let max = 0
      const rows = config.db.collections.runs.toArray as Array<{ key: string }>
      for (const row of rows) {
        const m = row.key.match(/^run-(\d+)/)
        if (!m) continue
        max = Math.max(max, parseInt(m[1]!, 10) + 1)
      }
      recordRunCounter = max
    }
    const key = `run-${recordRunCounter}`
    recordRunCounter += 1
    return key
  }

  const contextApi = createContextEntriesApi({
    db: config.db,
    writeEvent: config.writeEvent,
    wakeSession: config.wakeSession,
  })

  function structuralHash(nextConfig: UseContextConfig): string {
    const sources = Object.entries(nextConfig.sources)
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(
        ([name, source]) => [name, source.max ?? null, source.cache] as const
      )
    return JSON.stringify({
      sourceBudget: nextConfig.sourceBudget,
      sources,
    })
  }

  function readContextHistoryOffset(row: { key: string }): string | undefined {
    const contextInserted = config.db.collections.contextInserted
    const rowOffset = contextInserted.__electricRowOffsets?.get(row.key)
    if (typeof rowOffset === `string`) {
      return rowOffset
    }

    const seq = Reflect.get(row, `_seq`)
    if (typeof seq === `number`) {
      return `seq:${seq.toString().padStart(12, `0`)}`
    }

    return undefined
  }

  function assertValidUseContextConfig(nextConfig: UseContextConfig): void {
    if (
      !Number.isFinite(nextConfig.sourceBudget) ||
      nextConfig.sourceBudget <= 0
    ) {
      throw new Error(
        `[agent-runtime] useContext: sourceBudget must be a positive finite number`
      )
    }

    if (Object.keys(nextConfig.sources).length === 0) {
      throw new Error(
        `[agent-runtime] useContext: sources must contain at least one source`
      )
    }

    let nonVolatileMaxSum = 0
    for (const [name, source] of Object.entries(nextConfig.sources)) {
      if (!CACHE_TIERS.includes(source.cache)) {
        throw new Error(
          `[agent-runtime] useContext: unknown cache tier "${String(source.cache)}" for source "${name}"; expected ${CACHE_TIERS.join(` | `)}`
        )
      }
      if (source.max != null) {
        if (!Number.isFinite(source.max) || source.max <= 0) {
          throw new Error(
            `[agent-runtime] useContext: source "${name}" max must be a positive finite number`
          )
        }
      } else if (source.cache !== `volatile`) {
        throw new Error(
          `[agent-runtime] useContext: source "${name}" must specify max unless cache is volatile`
        )
      }
      if (source.cache !== `volatile`) {
        nonVolatileMaxSum += source.max
      }
    }

    if (nonVolatileMaxSum > nextConfig.sourceBudget) {
      throw new Error(
        `[agent-runtime] useContext: non-volatile source max sum (${nonVolatileMaxSum}) exceeds sourceBudget (${nextConfig.sourceBudget}); reduce per-source max values or increase sourceBudget`
      )
    }
  }

  const agent: AgentHandle = {
    async run(input?: string): Promise<AgentRunResult> {
      if (!agentConfig) {
        throw new Error(
          `[agent-runtime] agent.run() called without useAgent().`
        )
      }

      if (config.prepareAgentRun) {
        await config.prepareAgentRun()
      }

      const activeAgentConfig = agentConfig

      const messageText = getTriggerMessageText(
        config.db,
        config.wakeEvent,
        config.events,
        config.wakeOffset
      )
      const effectiveInput = input ?? messageText

      async function runAgent(
        messages: Array<LLMMessage>,
        extraTools: Array<AgentTool> = []
      ): Promise<AgentRunResult> {
        const adapterFactory = createPiAgentAdapter({
          systemPrompt: activeAgentConfig.systemPrompt,
          model: activeAgentConfig.model,

          provider: activeAgentConfig.provider,

          tools: [...activeAgentConfig.tools, ...extraTools] as Array<never>,

          streamFn: activeAgentConfig.streamFn,

          getApiKey: activeAgentConfig.getApiKey,

          onPayload: activeAgentConfig.onPayload,
        })
        const handle = adapterFactory({
          entityUrl: config.entityUrl,
          epoch: config.epoch,
          messages,
          outboundIdSeed: await loadOutboundIdSeed(config.db),
          writeEvent: config.writeEvent,
        })

        const latestMessageRole = messages.at(-1)?.role
        const runInput =
          input !== undefined || latestMessageRole !== `user`
            ? effectiveInput
            : undefined

        const logPrefix = `[${config.entityUrl}]`
        runtimeLog.info(
          logPrefix,
          `agent.run starting provider=${agentModelProvider(activeAgentConfig)} ` +
            `model=${agentModelId(activeAgentConfig.model)} ` +
            `messages=${messages.length} latestRole=${latestMessageRole ?? `none`} ` +
            `wakeType=${config.wakeEvent.type} wakeOffset=${config.wakeOffset} ` +
            `triggerMessageLen=${messageText.length} ` +
            `runInputLen=${runInput?.length ?? 0} ` +
            `tools=${activeAgentConfig.tools.length + extraTools.length}`
        )
        if (messages.length > 0) {
          const tail = messages.slice(-3)
          runtimeLog.info(
            logPrefix,
            `agent.run last messages: ${tail
              .map(
                (m) =>
                  `${m.role}=${typeof m.content === `string` ? m.content.slice(0, 80) : `[non-string]`}`
              )
              .join(` | `)}`
          )
        }
        if (runInput !== undefined) {
          runtimeLog.info(
            logPrefix,
            `agent.run input: ${runInput.slice(0, 200)}`
          )
        }

        await handle.run(runInput)
        runtimeLog.info(logPrefix, `agent.run completed`)

        return {
          writes: [],
          toolCalls: [],
          usage: { tokens: 0, duration: 0 },
        }
      }

      if (activeAgentConfig.testResponses) {
        const bridge = createOutboundBridge(
          await loadOutboundIdSeed(config.db),
          config.writeEvent
        )
        const responses = activeAgentConfig.testResponses

        function emitResponse(response: string): void {
          bridge.onTextStart()
          if (response.length > 0) {
            bridge.onTextDelta(response)
          }
          bridge.onTextEnd()
        }

        try {
          bridge.onRunStart()
          bridge.onStepStart({
            modelProvider: `test`,
            modelId: agentModelId(activeAgentConfig.model),
          })

          if (Array.isArray(responses)) {
            const priorRunCount = (
              await queryOnce((q) =>
                q.from({ runs: config.db.collections.runs })
              )
            ).length
            emitResponse(
              responses[priorRunCount % Math.max(responses.length, 1)] ?? ``
            )
          } else {
            const response = await responses(messageText, bridge)
            if (response !== undefined) {
              emitResponse(response)
            }
          }

          bridge.onStepEnd({ finishReason: `stop`, durationMs: 0 })
          bridge.onRunEnd({ finishReason: `stop` })
        } catch (error) {
          bridge.onStepEnd({ finishReason: `error`, durationMs: 0 })
          bridge.onRunEnd({ finishReason: `error` })
          throw error
        }

        return {
          writes: [],
          toolCalls: [],
          usage: { tokens: 0, duration: 0 },
        }
      }

      if (useContextConfig) {
        const assembled = await assembleContext(useContextConfig)
        const messages = assembled.map(
          ({ at: _at, ...message }) => message as LLMMessage
        )
        const assembledResult = assembled.__result

        const autoTools = createContextTools({
          loadTimelineRange: ({ from, to }) =>
            Promise.resolve(
              runtimeTimelineMessages(config.db, { since: from })
                .filter((message) => message.at <= to)
                .map(({ at: _at, ...message }) => JSON.stringify(message))
                .join(`\n`)
            ),
          loadSourceRange: ({ snapshot, from, to }) => {
            const sourceSnapshot = assembledResult?.snapshots.get(snapshot)
            if (!sourceSnapshot) {
              return missingContextToolData(`[missing snapshot ${snapshot}]`)
            }
            return Promise.resolve(sliceChars(sourceSnapshot.content, from, to))
          },
          loadContextHistory: ({ id, offset }) => {
            const contextInserted = config.db.collections.contextInserted
            for (const row of contextInserted.toArray) {
              if (row.id !== id) {
                continue
              }
              if (readContextHistoryOffset(row) === offset) {
                return Promise.resolve(row.content)
              }
            }
            return missingContextToolData(
              `[missing context history for ${id} @ ${offset}]`
            )
          },
        })
        return runAgent(messages, autoTools)
      }

      return runAgent(timelineToMessages(config.db))
    },
  }

  const ctx: DebugHandlerContext<TState> = {
    firstWake: config.firstWake,
    tags: config.tags,
    entityUrl: config.entityUrl,
    entityType: config.entityType,
    args: config.args,
    db: config.db,
    events: config.events,
    state: config.state,
    actions: config.actions,
    electricTools: config.electricTools,
    useAgent(cfg) {
      agentConfig = cfg
      return agent
    },
    useContext(nextConfig) {
      assertValidUseContextConfig(nextConfig)
      const hash = structuralHash(nextConfig)
      if (hash !== useContextHash) {
        useContextHash = hash
        useContextRegistrations += 1
      }
      useContextConfig = nextConfig
    },
    timelineMessages(opts?: TimelineProjectionOpts) {
      return runtimeTimelineMessages(config.db, opts)
    },
    insertContext: contextApi.insertContext,
    removeContext: contextApi.removeContext,
    getContext: contextApi.getContext,
    listContext: contextApi.listContext,
    __debug: {
      useContextRegistrations: () => useContextRegistrations,
    },
    agent,
    observe: ((source: ObservationSource, opts?: { wake?: Wake }) => {
      return config.doObserve(source, opts?.wake) as Promise<
        ObservationHandle & EntityHandle & SharedStateHandle
      >
    }) as DebugHandlerContext<TState>[`observe`],
    spawn(
      type: string,
      id: string,
      args?: Record<string, unknown>,
      opts?: {
        initialMessage?: unknown
        wake?: Wake
        tags?: Record<string, string>
        observe?: boolean
      }
    ): Promise<EntityHandle> {
      return config.doSpawn(type, id, args, opts)
    },
    mkdb<TSchema extends SharedStateSchemaMap>(
      id: string,
      schema: TSchema
    ): SharedStateHandle<TSchema> {
      return config.doMkdb(id, schema)
    },
    async spawnCodingAgent(
      opts: SpawnCodingAgentOptions
    ): Promise<CodingAgentHandle> {
      // The coding-agent entity's creationSchema is FLAT (the agents-server-ui
      // SpawnArgsDialog only renders simple types). Translate the nested
      // SpawnCodingAgentOptions.workspace into the flat workspaceType/Name/HostPath
      // fields that the handler reconstructs on first-wake init.
      const spawnArgs: Record<string, unknown> = { kind: opts.kind }
      if (opts.model !== undefined) {
        spawnArgs.model = opts.model
      }
      if (opts.workspace.type === `volume`) {
        spawnArgs.workspaceType = `volume`
        if (opts.workspace.name !== undefined) {
          spawnArgs.workspaceName = opts.workspace.name
        }
      } else {
        spawnArgs.workspaceType = `bindMount`
        spawnArgs.workspaceHostPath = opts.workspace.hostPath
      }
      if (opts.lifecycle?.idleTimeoutMs !== undefined) {
        spawnArgs.idleTimeoutMs = opts.lifecycle.idleTimeoutMs
      }
      if (opts.lifecycle?.keepWarm !== undefined) {
        spawnArgs.keepWarm = opts.lifecycle.keepWarm
      }
      if (opts.from !== undefined) {
        spawnArgs.fromAgentId = opts.from.agentId
        if (opts.from.workspaceMode !== undefined) {
          spawnArgs.fromWorkspaceMode = opts.from.workspaceMode
        }
      }

      // initialMessage is stored verbatim as the inbox row's payload (no message_type
      // extraction in the spawn path). Match the entity's promptMessageSchema shape:
      // flat { text } object, NOT { type: 'prompt', payload: { text } }.
      const initialMessage =
        opts.initialPrompt !== undefined
          ? { text: opts.initialPrompt }
          : undefined

      // Slice A: only `runFinished` wake (eventAppended is Slice C).
      const wake: Wake = `runFinished`

      const entityHandle = await config.doSpawn(
        `coding-agent`,
        opts.id,
        spawnArgs,
        {
          observe: true,
          wake,
          ...(initialMessage ? { initialMessage } : {}),
        }
      )

      const agentUrl = `/coding-agent/${opts.id}`
      return makeCodingAgentHandle(config, agentUrl, entityHandle, opts.kind)
    },
    async observeCodingAgent(id: string): Promise<CodingAgentHandle> {
      const url = `/coding-agent/${id}`
      const entityHandle = await config.doObserve(
        entityObservationSource(url),
        `runFinished`
      )
      return makeCodingAgentHandle(config, url, entityHandle)
    },
    send(
      entityUrl: string,
      payload: unknown,
      opts?: { type?: string; afterMs?: number }
    ): void {
      config.executeSend({
        targetUrl: entityUrl,
        payload,
        type: opts?.type,
        afterMs: opts?.afterMs,
      })
    },
    recordRun(): RunHandle {
      const key = nextRunKey()
      let deltaCounter = 0
      config.writeEvent(
        entityStateSchema.runs.insert({
          key,
          value: { status: `started` } as never,
        }) as ChangeEvent
      )
      return {
        key,
        end({ status, finishReason }): void {
          config.writeEvent(
            entityStateSchema.runs.update({
              key,
              value: {
                status,
                finish_reason:
                  finishReason ?? (status === `failed` ? `error` : `stop`),
              } as never,
            }) as ChangeEvent
          )
        },
        attachResponse(text: string): void {
          if (typeof text !== `string` || text.length === 0) return
          config.writeEvent(
            entityStateSchema.textDeltas.insert({
              key: `${key}:delta-${deltaCounter}`,
              value: {
                text_id: key,
                run_id: key,
                delta: text,
              } as never,
            }) as ChangeEvent
          )
          deltaCounter += 1
        },
      }
    },
    sleep(): void {
      sleepRequested = true
    },
    setTag(key: string, value: string): Promise<void> {
      return config.doSetTag(key, value)
    },
    removeTag(key: string): Promise<void> {
      return config.doRemoveTag(key)
    },
  }

  return { ctx, getSleepRequested: () => sleepRequested }
}

function makeCodingAgentHandle(
  config: HandlerContextConfig,
  url: string,
  entityHandle: { db?: { collections?: any } },
  defaultKind: CodingAgentKind = `claude`
): CodingAgentHandle {
  const readMeta = (): any => {
    const c = entityHandle.db?.collections?.sessionMeta
    return c?.get?.(`current`)
  }
  const readRuns = (): Array<CodingAgentRunSummary> => {
    const c = entityHandle.db?.collections?.runs
    if (!c) return []
    const rows = (c as { toArray?: unknown }).toArray
    if (!Array.isArray(rows)) return []
    return rows.map((r: any) => ({
      runId: r.key,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      status: r.status,
      promptInboxKey: r.promptInboxKey,
      responseText: r.responseText,
    }))
  }

  return {
    url,
    // Live getter so the handle reflects the entity's actual kind once
    // sessionMeta is loaded (covers observeCodingAgent which doesn't
    // know the kind upfront). Falls back to defaultKind if meta hasn't
    // arrived yet (e.g. immediately after spawn).
    get kind(): CodingAgentKind {
      const meta = readMeta()
      return (meta?.kind as CodingAgentKind | undefined) ?? defaultKind
    },
    send: (text: string) => {
      config.executeSend({
        targetUrl: url,
        payload: { text },
        type: `prompt`,
      })
      return Promise.resolve()
    },
    pin: () => {
      config.executeSend({ targetUrl: url, payload: {}, type: `pin` })
      return Promise.resolve()
    },
    release: () => {
      config.executeSend({ targetUrl: url, payload: {}, type: `release` })
      return Promise.resolve()
    },
    stop: () => {
      config.executeSend({ targetUrl: url, payload: {}, type: `stop` })
      return Promise.resolve()
    },
    destroy: () => {
      config.executeSend({ targetUrl: url, payload: {}, type: `destroy` })
      return Promise.resolve()
    },
    state(): CodingAgentState {
      const meta = readMeta()
      return {
        status: meta?.status ?? `cold`,
        pinned: meta?.pinned ?? false,
        workspace: {
          identity: meta?.workspaceIdentity ?? ``,
          sharedRefs: 1, // Server-only state; Slice A clients see 1.
        },
        lastError: meta?.lastError,
        runs: readRuns(),
      }
    },
    events(opts?: { since?: `start` | `now` }) {
      const since = opts?.since ?? `now`
      const c = entityHandle.db?.collections?.events
      const rows: Array<{ payload: unknown }> =
        c && Array.isArray((c as any).toArray) ? (c as any).toArray : []
      const initial = since === `start` ? rows.slice() : []
      return (async function* () {
        for (const r of initial) yield r.payload
      })()
    },
  }
}
