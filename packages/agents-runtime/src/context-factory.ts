import { queryOnce } from '@durable-streams/state/db'
import { assembleContext } from './context-assembly'
import { createContextEntriesApi } from './context-entries'
import { entityStateSchema } from './entity-schema'
import { createGoalApi } from './goal-api'
import { formatPointerOrderToken } from './event-pointer'
import {
  allocateRunKey,
  createOutboundBridge,
  loadOutboundIdSeed,
} from './outbound-bridge'
import { createPiAgentAdapter } from './pi-adapter'
import {
  timelineMessages as runtimeTimelineMessages,
  timelineToMessages,
} from './timeline-context'
import { getCronStreamPath } from './cron-utils'
import { runtimeLog } from './log'
import { sliceChars } from './token-budget'
import {
  selectLatestContextUsage,
  truncateOversizedToolResults,
  withContextBudgetNotice,
  CONTEXT_USAGE_HARD_CEILING,
  type ContextUsageStep,
} from './token-accountant'
import { approxTokens } from './token-budget'
import {
  COMPACTION_CHECKPOINT_ID,
  COMPACTION_CHECKPOINT_KIND,
  COMPACTION_CHECKPOINT_NAME,
} from './compaction'
import { summarizeMessages } from './compaction-summarize'
import { createContextTools } from './tools/context-tools'
import { CACHE_TIERS } from './types'
import { composeToolsWithProviders } from './tool-providers'
import { validateSlashCommandDefinitions } from './composer-input'
import type { HydratedWebhookSourceWake } from './webhook-sources'
import type { ChangeEvent } from '@durable-streams/state'
import type { Sandbox } from './sandbox/types'
import type {
  DynamicSlashCommandRegistration,
  SlashCommandDefinition,
  SlashCommandHelpers,
  SlashCommandRow,
} from './composer-input'
import type {
  AgentConfig,
  AgentHandle,
  AgentModel,
  AgentRunResult,
  AgentTool,
  AttachmentCreateInput,
  AttachmentsApi,
  EntitySignal,
  EntityHandle,
  EntityStreamDBWithActions,
  ForkOptions,
  HandlerContext,
  LLMContentBlock,
  HandlerWake,
  LLMMessage,
  ManifestAttachmentEntry,
  ObservationHandle,
  ObservationSource,
  RunHandle,
  SendResult,
  SharedStateHandle,
  SharedStateSchemaMap,
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

const MAX_HYDRATED_IMAGE_ATTACHMENTS = 4
const MAX_HYDRATED_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024

export interface HandlerContextConfig<TState extends StateProxy = StateProxy> {
  entityUrl: string
  entityType: string
  epoch: number
  wakeOffset: string
  firstWake: boolean
  tags: Readonly<Record<string, string>>
  principal?: HandlerContext[`principal`]
  args: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  state: TState
  actions: Record<string, (...args: Array<unknown>) => unknown>
  staticSlashCommands?: Array<SlashCommandDefinition>
  electricTools: Array<AgentTool>
  sandbox: Sandbox
  events: Array<ChangeEvent>
  writeEvent: (event: ChangeEvent) => void
  wakeSession: WakeSession
  wakeEvent: WakeEvent
  runSignal?: AbortSignal
  registerSignalHandler?: (
    handler: (signal: {
      signal: EntitySignal
      reason?: string
      payload?: unknown
    }) => void | Promise<void>
  ) => void
  hydratedWebhookSourceWake?: HydratedWebhookSourceWake | null
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
      initialMessageType?: string
      wake?: Wake
      tags?: Record<string, string>
      observe?: boolean
    }
  ) => Promise<EntityHandle>
  doFork: (
    sourceEntityUrl: string,
    id: string,
    opts: ForkOptions
  ) => Promise<EntityHandle>
  doMkdb: <TSchema extends SharedStateSchemaMap>(
    id: string,
    schema: TSchema
  ) => SharedStateHandle<TSchema>
  doCreateAttachment?: (
    input: AttachmentCreateInput
  ) => Promise<ManifestAttachmentEntry>
  doReadAttachment?: (id: string) => Promise<Uint8Array>
  prepareAgentRun?: () => Promise<void>
  executeSend: (send: {
    targetUrl: string
    payload: unknown
    type?: string
    afterMs?: number
  }) => Promise<SendResult>
  doSetTag: (key: string, value: string) => Promise<void>
  doDeleteTag: (key: string) => Promise<void>
  doUnobserve: (sourceRef: string) => Promise<void>
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
  wakeOffset: string,
  hydratedWebhookSourceWake?: HydratedWebhookSourceWake | null
): string {
  if (wakeEvent.type === `inbox`) {
    let latestPayload: unknown = wakeEvent.payload
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]!
      if (event.type !== `inbox`) {
        continue
      }

      const value = event.value as
        | {
            payload?: unknown
            status?: `pending` | `processed` | `cancelled`
          }
        | undefined
      if (value?.status === `cancelled`) {
        continue
      }
      const payload = value?.payload
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
    if (hydratedWebhookSourceWake) {
      return asMessageText(hydratedWebhookSourceWake)
    }

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

function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  // Prefer the platform helper when available (Node 20+, modern browsers).
  const any = (
    AbortSignal as unknown as {
      any?: (sigs: Array<AbortSignal>) => AbortSignal
    }
  ).any
  if (typeof any === `function`) return any.call(AbortSignal, [a, b])
  const controller = new AbortController()
  const linkTo = (source: AbortSignal): void => {
    if (source.aborted) {
      controller.abort(source.reason)
      return
    }
    source.addEventListener(`abort`, () => controller.abort(source.reason), {
      once: true,
    })
  }
  linkTo(a)
  linkTo(b)
  return controller.signal
}

function toHandlerWake(wakeEvent: WakeEvent): HandlerWake {
  if (wakeEvent.type === `inbox`) {
    return {
      type: `inbox`,
      source: wakeEvent.source,
      raw: wakeEvent,
      message: {
        type: wakeEvent.summary ?? `message`,
        payload: wakeEvent.payload,
        from: wakeEvent.source,
      },
    }
  }

  return {
    type: `other`,
    wakeType: wakeEvent.type,
    source: wakeEvent.source,
    payload: wakeEvent.payload,
    raw: wakeEvent,
  }
}

function createSlashCommandHelpers(
  config: Pick<
    HandlerContextConfig,
    `db` | `writeEvent` | `staticSlashCommands`
  >
): SlashCommandHelpers {
  type DynamicLayer = DynamicSlashCommandRegistration & { updated_at: string }
  const staticCommands = new Map(
    (config.staticSlashCommands ?? []).map((command) => [command.name, command])
  )
  const slashCommandsCollection = config.db.collections.slashCommands
  const rows = new Map(
    ((slashCommandsCollection?.toArray ?? []) as Array<SlashCommandRow>).map(
      (row) => [row.name, row]
    )
  )
  const dynamicLayers = new Map<string, Array<DynamicLayer>>()

  for (const row of rows.values()) {
    const layers =
      row.dynamic_layers ??
      (row.source === `dynamic`
        ? [
            {
              name: row.name,
              description: row.description,
              arguments: row.arguments,
              owner: row.owner,
              version: row.version,
              updated_at: row.updated_at,
            },
          ]
        : [])
    if (layers.length > 0) {
      dynamicLayers.set(row.name, [...layers])
    }
  }

  const listRows = (): Array<SlashCommandRow> => Array.from(rows.values())

  const getRow = (name: string): SlashCommandRow | undefined => {
    return rows.get(name)
  }

  const writeRow = (row: SlashCommandRow): void => {
    const existing = getRow(row.name)
    rows.set(row.name, row)
    const helper = existing
      ? entityStateSchema.slashCommands.update
      : entityStateSchema.slashCommands.insert

    config.writeEvent(
      helper({
        key: row.name,
        value: row,
      } as never) as ChangeEvent
    )
  }

  const deleteRow = (name: string): void => {
    rows.delete(name)
    config.writeEvent(
      entityStateSchema.slashCommands.delete({
        key: name,
      } as never) as ChangeEvent
    )
  }

  const writeEffectiveRow = (name: string): void => {
    const layers = dynamicLayers.get(name) ?? []
    const topLayer = layers.at(-1)
    if (topLayer) {
      writeRow({
        ...topLayer,
        key: name,
        source: `dynamic`,
        dynamic_layers: layers,
      })
      return
    }

    const staticCommand = staticCommands.get(name)
    if (!staticCommand) {
      deleteRow(name)
      return
    }

    writeRow({
      ...staticCommand,
      key: staticCommand.name,
      source: `static`,
      updated_at: new Date().toISOString(),
    })
  }

  const assertValid = (commands: Array<SlashCommandDefinition>): void => {
    const validation = validateSlashCommandDefinitions(commands)
    if (validation) {
      throw new Error(
        `[agent-runtime] invalid slash command definition: ${validation.details
          .map((issue) => `${issue.path} ${issue.message}`)
          .join(`; `)}`
      )
    }
  }

  const register = (command: DynamicSlashCommandRegistration): void => {
    assertValid([command])
    const owner = command.owner ?? `handler`
    const now = new Date().toISOString()
    const nextLayer = {
      ...command,
      owner,
      updated_at: now,
    }
    const existingLayers = dynamicLayers.get(command.name) ?? []
    dynamicLayers.set(command.name, [
      ...existingLayers.filter((layer) => layer.owner !== owner),
      nextLayer,
    ])
    writeEffectiveRow(command.name)
  }

  return {
    get: getRow,
    list: listRows,
    register,
    unregister(name, opts): void {
      const existing = getRow(name)
      const layers = dynamicLayers.get(name) ?? []
      if (opts?.owner) {
        if (!layers.some((layer) => layer.owner === opts.owner)) {
          return
        }
      } else if (existing?.source !== `dynamic`) {
        return
      }
      const owner = opts?.owner ?? existing?.owner
      dynamicLayers.set(
        name,
        owner ? layers.filter((layer) => layer.owner !== owner) : []
      )
      writeEffectiveRow(name)
    },
    replaceOwned(owner, commands): void {
      const ownedCommands = commands.map((command) => ({ ...command, owner }))
      assertValid(ownedCommands)

      const nextNames = new Set(ownedCommands.map((command) => command.name))
      for (const [name, layers] of [...dynamicLayers.entries()]) {
        if (!layers.some((layer) => layer.owner === owner)) {
          continue
        }
        if (nextNames.has(name)) {
          continue
        }
        dynamicLayers.set(
          name,
          layers.filter((layer) => layer.owner !== owner)
        )
        writeEffectiveRow(name)
      }

      for (const command of ownedCommands) {
        register(command)
      }
    },
  }
}

export function createHandlerContext<TState extends StateProxy = StateProxy>(
  config: HandlerContextConfig<TState>
): HandlerContextResult<TState> {
  let sleepRequested = false
  let agentConfig: AgentConfig | null = null
  let useContextConfig: UseContextConfig | null = null
  let useContextHash = ``
  let useContextRegistrations = 0
  // Run-id allocation for ctx.recordRun() / ctx.replyText(). Delegates
  // to the outbound bridge's shared id-seed cache so synthetic runs
  // can't collide with `run-N` keys the bridge allocated for events
  // that haven't round-tripped into the local collection yet. The local
  // floor keeps sequential allocations monotonic within this handler
  // even when the collection lags (or has no stable id, as in tests).
  let localRunFloor = 0
  const nextRunKey = (): string => {
    const key = allocateRunKey(config.db, localRunFloor)
    localRunFloor = parseInt(key.slice(`run-`.length), 10) + 1
    return key
  }

  const contextApi = createContextEntriesApi({
    db: config.db,
    writeEvent: config.writeEvent,
    wakeSession: config.wakeSession,
  })

  const goalApi = createGoalApi({
    db: config.db,
    wakeSession: config.wakeSession,
    writeEvent: config.writeEvent,
  })

  const listAttachments: AttachmentsApi[`list`] = (filter) => {
    const attachments = config.db.collections.manifests.toArray
      .filter((entry) => entry.kind === `attachment`)
      .map((entry) => entry as unknown as ManifestAttachmentEntry)
    return attachments.filter((attachment) => {
      if (filter?.role && attachment.role !== filter.role) return false
      if (
        filter?.subject &&
        (attachment.subject.type !== filter.subject.type ||
          attachment.subject.key !== filter.subject.key)
      ) {
        return false
      }
      return true
    })
  }

  const attachmentsApi: AttachmentsApi = {
    list: listAttachments,
    get(id) {
      return listAttachments().find((attachment) => attachment.id === id)
    },
    async read(id) {
      if (!config.doReadAttachment) {
        throw new Error(`[agent-runtime] attachments.read() is not configured`)
      }
      return await config.doReadAttachment(id)
    },
    async create(input) {
      if (!config.doCreateAttachment) {
        throw new Error(
          `[agent-runtime] attachments.create() is not configured`
        )
      }
      return await config.doCreateAttachment(input)
    },
  }

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

  function bytesToBase64(bytes: Uint8Array): string {
    const chunkSize = 0x8000
    let binary = ``
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }

  function attachmentDescriptor(attachment: ManifestAttachmentEntry): string {
    return `${attachment.filename ?? attachment.id}, type=${attachment.mimeType}, size=${attachment.byteLength ?? `unknown`}`
  }

  function selectHydratableImageAttachmentIds(
    messages: Array<LLMMessage>
  ): Set<string> {
    const selected = new Set<string>()
    let selectedBytes = 0

    for (
      let messageIndex = messages.length - 1;
      messageIndex >= 0;
      messageIndex--
    ) {
      const message = messages[messageIndex]
      if (!message || typeof message.content === `string`) continue

      for (
        let blockIndex = message.content.length - 1;
        blockIndex >= 0;
        blockIndex--
      ) {
        const block = message.content[blockIndex]
        if (!block || block.type !== `attachment` || selected.has(block.id)) {
          continue
        }

        const attachment = attachmentsApi.get(block.id)
        if (
          !attachment ||
          attachment.status !== `complete` ||
          !attachment.mimeType.startsWith(`image/`)
        ) {
          continue
        }

        const byteLength = attachment.byteLength ?? 0
        if (
          selected.size >= MAX_HYDRATED_IMAGE_ATTACHMENTS ||
          selectedBytes + byteLength > MAX_HYDRATED_IMAGE_ATTACHMENT_BYTES
        ) {
          continue
        }

        selected.add(block.id)
        selectedBytes += byteLength
      }
    }

    return selected
  }

  async function hydrateAttachmentBlocks(
    messages: Array<LLMMessage>
  ): Promise<Array<LLMMessage>> {
    const hydratableImageAttachmentIds =
      selectHydratableImageAttachmentIds(messages)

    return await Promise.all(
      messages.map(async (message) => {
        if (typeof message.content === `string`) {
          return message
        }
        const content = await Promise.all(
          message.content.map(async (block): Promise<LLMContentBlock> => {
            if (block.type !== `attachment`) {
              return block
            }
            const attachment = attachmentsApi.get(block.id)
            if (!attachment) {
              return {
                type: `text`,
                text: `[attachment missing: id=${block.id}]`,
              }
            }
            if (
              attachment.status !== `complete` ||
              !attachment.mimeType.startsWith(`image/`)
            ) {
              return {
                type: `text`,
                text: `[attachment: ${attachmentDescriptor(attachment)}]`,
              }
            }
            if (!hydratableImageAttachmentIds.has(block.id)) {
              return {
                type: `text`,
                text: `[attachment not sent to model: ${attachmentDescriptor(attachment)}, reason=image attachment prompt limit]`,
              }
            }
            try {
              const bytes = await attachmentsApi.read(block.id)
              return {
                type: `image`,
                data: bytesToBase64(bytes),
                mimeType: attachment.mimeType,
              }
            } catch (error) {
              return {
                type: `text`,
                text: `[attachment unreadable: id=${block.id}, error=${error instanceof Error ? error.message : String(error)}]`,
              }
            }
          })
        )
        return { ...message, content }
      })
    )
  }

  function readContextHistoryOffset(row: { key: string }): string | undefined {
    const contextInserted = config.db.collections.contextInserted
    const pointer = contextInserted.__electricRowOffsets?.get(row.key)
    if (pointer) {
      // Format the pointer as a stable, sortable string. Matches the
      // `_timeline_order` produced by `entity-stream-db` so that
      // `loadContextHistory(id, offset)` can round-trip lookups
      // against the same row.
      return formatPointerOrderToken(pointer)
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
    async run(
      input?: string,
      abortSignal?: AbortSignal
    ): Promise<AgentRunResult> {
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
        config.wakeOffset,
        config.hydratedWebhookSourceWake
      )
      const effectiveInput = input ?? messageText

      async function runAgent(
        messages: Array<LLMMessage>,
        extraTools: Array<AgentTool> = []
      ): Promise<AgentRunResult> {
        const composedTools = (await composeToolsWithProviders(
          activeAgentConfig.tools
        )) as Array<AgentTool>

        // Phase 1: surface the remaining context budget to the model once usage
        // reaches the first awareness threshold (25%). Synthesized fresh each
        // call from the latest persisted step — so it is always current, and we
        // deliberately do NOT persist it as a context row (a self-superseding
        // entry would leave `load_context_history(...)` tombstones, which are
        // meaningless breadcrumbs for an ephemeral budget hint). The notice is
        // injected just before the final message so the closing turn — and the
        // runInput detection below, which reads `.at(-1)` — is unchanged.
        const budgetUsage = selectLatestContextUsage(
          config.db.collections.steps.toArray as ReadonlyArray<ContextUsageStep>
        )

        // Phase 2 hard ceiling: if the last turn left context at/over 95% of
        // the window, compact synchronously before this model call. Summarize
        // the current history, persist a compaction checkpoint (so future turns
        // reconstruct from it via the timeline watermark), and send only the
        // summary this turn — the current ask is delivered separately as
        // runInput. The `approxTokens` guard avoids re-compacting an already
        // compacted (small) history while the last step's usage is still high.
        let workingMessages = messages
        let didCompact = false
        const estimatedHistoryTokens = messages.reduce(
          (sum, message) => sum + approxTokens(message.content),
          0
        )
        if (
          budgetUsage &&
          budgetUsage.ratio >= CONTEXT_USAGE_HARD_CEILING &&
          estimatedHistoryTokens > budgetUsage.contextWindow / 2
        ) {
          const logPrefix = `[${config.entityUrl}]`
          try {
            const provider = agentModelProvider(activeAgentConfig)
            const apiKey = await activeAgentConfig.getApiKey?.(provider)
            const summary = await summarizeMessages({
              model: activeAgentConfig.model,
              provider,
              messages,
              ...(apiKey ? { apiKey } : {}),
              ...(activeAgentConfig.summarizeComplete
                ? { complete: activeAgentConfig.summarizeComplete }
                : {}),
            })
            contextApi.insertContext(COMPACTION_CHECKPOINT_ID, {
              name: COMPACTION_CHECKPOINT_NAME,
              attrs: { kind: COMPACTION_CHECKPOINT_KIND },
              content: summary,
            })
            workingMessages = [
              {
                role: `user`,
                content: `<${COMPACTION_CHECKPOINT_NAME}>\n${summary}\n</${COMPACTION_CHECKPOINT_NAME}>`,
              },
            ]
            didCompact = true
            runtimeLog.info(
              logPrefix,
              `compaction: summarized ${messages.length} messages at ratio=${budgetUsage.ratio.toFixed(2)} window=${budgetUsage.contextWindow}`
            )
          } catch (error) {
            runtimeLog.warn(
              logPrefix,
              `compaction failed; proceeding uncompacted: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }

        // Cap any single oversized tool result (one huge output can fill the
        // window on its own), then surface the budget notice. After a fresh
        // compaction the last step's ratio is stale, so skip the notice this
        // turn rather than report a misleading "~0% remaining".
        const outgoingMessages = withContextBudgetNotice(
          truncateOversizedToolResults(workingMessages),
          didCompact ? null : budgetUsage
        )

        const adapterFactory = createPiAgentAdapter({
          systemPrompt: activeAgentConfig.systemPrompt,
          model: activeAgentConfig.model,

          provider: activeAgentConfig.provider,

          tools: [...composedTools, ...extraTools] as Array<never>,

          streamFn: activeAgentConfig.streamFn,

          getApiKey: activeAgentConfig.getApiKey,

          reasoning: activeAgentConfig.reasoning,
          thinkingBudgets: activeAgentConfig.thinkingBudgets,

          onPayload: activeAgentConfig.onPayload,

          onStepEnd: activeAgentConfig.onStepEnd,
          modelTimeoutMs: activeAgentConfig.modelTimeoutMs,
          modelMaxRetries: activeAgentConfig.modelMaxRetries,
        })
        const handle = adapterFactory({
          entityUrl: config.entityUrl,
          epoch: config.epoch,
          messages: outgoingMessages,
          outboundIdSeed: await loadOutboundIdSeed(config.db),
          writeEvent: config.writeEvent,
        })

        const latestMessageRole = outgoingMessages.at(-1)?.role
        const runInput =
          input !== undefined ||
          config.hydratedWebhookSourceWake != null ||
          latestMessageRole !== `user`
            ? effectiveInput
            : undefined

        const logPrefix = `[${config.entityUrl}]`
        runtimeLog.info(
          logPrefix,
          `agent.run starting provider=${agentModelProvider(activeAgentConfig)} ` +
            `model=${agentModelId(activeAgentConfig.model)} ` +
            `messages=${outgoingMessages.length} latestRole=${latestMessageRole ?? `none`} ` +
            `wakeType=${config.wakeEvent.type} wakeOffset=${config.wakeOffset} ` +
            `triggerMessageLen=${messageText.length} ` +
            `runInputLen=${runInput?.length ?? 0} ` +
            `tools=${composedTools.length + extraTools.length}`
        )
        if (outgoingMessages.length > 0) {
          const tail = outgoingMessages.slice(-3)
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

        const combinedSignal =
          config.runSignal && abortSignal
            ? combineAbortSignals(config.runSignal, abortSignal)
            : (abortSignal ?? config.runSignal)
        await handle.run(runInput, combinedSignal)
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
        return runAgent(await hydrateAttachmentBlocks(messages), autoTools)
      }

      return runAgent(
        await hydrateAttachmentBlocks(timelineToMessages(config.db))
      )
    },
  }

  const ctx: DebugHandlerContext<TState> = {
    firstWake: config.firstWake,
    wake: toHandlerWake(config.wakeEvent),
    slashCommands: createSlashCommandHelpers(config),
    tags: config.tags,
    principal: config.principal,
    entityUrl: config.entityUrl,
    entityType: config.entityType,
    args: config.args,
    db: config.db,
    events: config.events,
    state: config.state,
    actions: config.actions,
    electricTools: config.electricTools,
    signal: config.runSignal ?? new AbortController().signal,
    sandbox: config.sandbox,
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
    setGoal: goalApi.setGoal,
    clearGoal: goalApi.clearGoal,
    getGoal: goalApi.getGoal,
    markGoalComplete: goalApi.markGoalComplete,
    updateGoalUsage: goalApi.updateGoalUsage,
    __debug: {
      useContextRegistrations: () => useContextRegistrations,
    },
    agent,
    observe: ((source: ObservationSource, opts?: { wake?: Wake }) => {
      return config.doObserve(source, opts?.wake) as Promise<
        ObservationHandle & EntityHandle & SharedStateHandle
      >
    }) as DebugHandlerContext<TState>[`observe`],
    unobserve(sourceRef: string): Promise<void> {
      return config.doUnobserve(sourceRef)
    },
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
    fork(
      sourceEntityUrl: string,
      id: string,
      opts?: ForkOptions
    ): Promise<EntityHandle> {
      return config.doFork(sourceEntityUrl, id, opts ?? {})
    },
    forkSelf(id: string, opts?: ForkOptions): Promise<EntityHandle> {
      return config.doFork(config.entityUrl, id, opts ?? {})
    },
    mkdb<TSchema extends SharedStateSchemaMap>(
      id: string,
      schema: TSchema
    ): SharedStateHandle<TSchema> {
      return config.doMkdb(id, schema)
    },
    send(
      entityUrl: string,
      payload: unknown,
      opts?: { type?: string; afterMs?: number }
    ): Promise<SendResult> {
      return config.executeSend({
        targetUrl: entityUrl,
        payload,
        type: opts?.type,
        afterMs: opts?.afterMs,
      })
    },
    attachments: attachmentsApi,
    onSignal(handler): void {
      config.registerSignalHandler?.(handler)
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
    // Renders `text` as an ordinary assistant message in the chat without
    // calling the LLM. Used for runtime-driven replies like slash-command
    // responses and budget-limit notices. The five writes synthesize the
    // same run + text + delta event sequence the outbound bridge would
    // emit for a real LLM turn; the UI needs all of them to render.
    replyText(text: string): void {
      if (typeof text !== `string` || text.length === 0) return
      const runKey = nextRunKey()
      const msgKey = `${runKey}:msg`
      config.writeEvent(
        entityStateSchema.runs.insert({
          key: runKey,
          value: { status: `started` } as never,
        }) as ChangeEvent
      )
      config.writeEvent(
        entityStateSchema.texts.insert({
          key: msgKey,
          value: { status: `streaming`, run_id: runKey } as never,
        }) as ChangeEvent
      )
      config.writeEvent(
        entityStateSchema.textDeltas.insert({
          key: `${msgKey}:0`,
          value: {
            text_id: msgKey,
            run_id: runKey,
            delta: text,
          } as never,
        }) as ChangeEvent
      )
      config.writeEvent(
        entityStateSchema.texts.update({
          key: msgKey,
          value: { status: `completed`, run_id: runKey } as never,
        }) as ChangeEvent
      )
      config.writeEvent(
        entityStateSchema.runs.update({
          key: runKey,
          value: {
            status: `completed`,
            finish_reason: `stop`,
          } as never,
        }) as ChangeEvent
      )
    },
    sleep(): void {
      sleepRequested = true
    },
    setTag(key: string, value: string): Promise<void> {
      return config.doSetTag(key, value)
    },
    deleteTag(key: string): Promise<void> {
      return config.doDeleteTag(key)
    },
  }

  return {
    ctx,
    getSleepRequested: () => sleepRequested,
  }
}
