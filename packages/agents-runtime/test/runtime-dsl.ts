import http from 'node:http'
import { DurableStreamTestServer } from '@durable-streams/server'
import {
  createEntityRegistry,
  createRuntimeHandler,
  createRuntimeServerClient,
  getSharedStateStreamPath,
} from '../src/index'
import type { EntityDefinition, RuntimeHandler } from '../src/index'
import type { EntityRegistry } from '../src/define-entity'

export interface RuntimeStreamEvent extends Record<string, unknown> {
  type: string
  key?: string
  headers?: Record<string, unknown>
  value?: unknown
}

export interface RuntimeHistorySummaryEntry extends Record<string, unknown> {
  type: string
  operation?: string
}

type ElectricAgentsServerInstance = {
  start: () => Promise<string>
  stop: () => Promise<void>
}

type ElectricAgentsServerConstructor = new (opts: {
  durableStreamsUrl: string
  port: number
  postgresUrl: string
  electricUrl: string
}) => ElectricAgentsServerInstance

type TestBackendModule = {
  TEST_ELECTRIC_URL: string
  TEST_POSTGRES_URL: string
  resetElectricAgentsTestBackend: () => Promise<void>
}

const agentServerModulePath = `../../agents-server/src/server`
const agentServerTestBackendModulePath = `../../agents-server/test/test-backend`

async function loadElectricAgentsServer(): Promise<ElectricAgentsServerConstructor> {
  const module = (await import(agentServerModulePath)) as {
    ElectricAgentsServer: ElectricAgentsServerConstructor
  }
  return module.ElectricAgentsServer
}

async function loadTestBackend(): Promise<TestBackendModule> {
  return (await import(agentServerTestBackendModulePath)) as TestBackendModule
}

export class StreamHistory {
  readonly events: Array<RuntimeStreamEvent>

  constructor(events: Array<Record<string, unknown>>) {
    this.events = events as Array<RuntimeStreamEvent>
  }

  count(
    type: string,
    predicate?: (event: RuntimeStreamEvent) => boolean
  ): number {
    return this.events.filter(
      (event) => event.type === type && (!predicate || predicate(event))
    ).length
  }

  some(
    type: string,
    predicate?: (event: RuntimeStreamEvent) => boolean
  ): boolean {
    return this.count(type, predicate) > 0
  }

  find(
    type: string,
    predicate?: (event: RuntimeStreamEvent) => boolean
  ): RuntimeStreamEvent | undefined {
    return this.events.find(
      (event) => event.type === type && (!predicate || predicate(event))
    )
  }

  indexOf(
    type: string,
    predicate?: (event: RuntimeStreamEvent) => boolean
  ): number {
    return this.events.findIndex(
      (event) => event.type === type && (!predicate || predicate(event))
    )
  }

  completedRunCount(): number {
    return this.count(`run`, (event) => {
      const value = asRecord(event.value)
      const headers = asRecord(event.headers)
      return headers?.operation === `update` && value?.status === `completed`
    })
  }

  snapshot(): Array<RuntimeHistorySummaryEntry> {
    return this.events.map((event) => summarizeEvent(event))
  }

  filteredSnapshot(
    predicate: (
      entry: RuntimeHistorySummaryEntry,
      event: RuntimeStreamEvent
    ) => boolean
  ): Array<RuntimeHistorySummaryEntry> {
    const result: Array<RuntimeHistorySummaryEntry> = []

    for (const event of this.events) {
      const entry = summarizeEvent(event)
      if (predicate(entry, event)) {
        result.push(entry)
      }
    }

    return result
  }
}

export interface RuntimeEntityRef {
  entityUrl: string
  send: (
    payload: unknown,
    opts?: { from?: string; type?: string }
  ) => Promise<void>
  history: () => Promise<StreamHistory>
  snapshot: () => Promise<Array<RuntimeHistorySummaryEntry>>
  waitFor: (
    predicate: (history: StreamHistory) => boolean,
    timeoutMs?: number
  ) => Promise<StreamHistory>
  waitForTypeCount: (
    type: string,
    count: number,
    opts?: {
      timeoutMs?: number
      predicate?: (event: RuntimeStreamEvent) => boolean
    }
  ) => Promise<StreamHistory>
  waitForOperation: (
    type: string,
    operation: string,
    opts?: {
      count?: number
      timeoutMs?: number
      predicate?: (event: RuntimeStreamEvent) => boolean
    }
  ) => Promise<StreamHistory>
  waitForRun: (timeoutMs?: number) => Promise<StreamHistory>
  waitForRunCount: (count: number, timeoutMs?: number) => Promise<StreamHistory>
  waitForSettled: (timeoutMs?: number) => Promise<StreamHistory>
}

export interface RuntimeSharedStateRef {
  sharedStateId: string
  history: () => Promise<StreamHistory>
  snapshot: () => Promise<Array<RuntimeHistorySummaryEntry>>
  waitFor: (
    predicate: (history: StreamHistory) => boolean,
    timeoutMs?: number
  ) => Promise<StreamHistory>
  waitForTypeCount: (
    type: string,
    count: number,
    opts?: {
      timeoutMs?: number
      predicate?: (event: RuntimeStreamEvent) => boolean
    }
  ) => Promise<StreamHistory>
  waitForOperation: (
    type: string,
    operation: string,
    opts?: {
      count?: number
      timeoutMs?: number
      predicate?: (event: RuntimeStreamEvent) => boolean
    }
  ) => Promise<StreamHistory>
  waitForSettled: (timeoutMs?: number) => Promise<StreamHistory>
}

export interface RuntimeTestBuilder {
  define: (name: string, definition: EntityDefinition) => RuntimeTestBuilder
  prepare: () => Promise<void>
  spawn: (
    typeName: string,
    instanceId: string,
    args?: Record<string, unknown>,
    opts?: { initialMessage?: unknown }
  ) => Promise<RuntimeEntityRef>
  entity: (entityUrl: string) => RuntimeEntityRef
  sharedState: (sharedStateId: string) => RuntimeSharedStateRef
  send: (
    entityUrl: string,
    payload: unknown,
    opts?: { from?: string; type?: string }
  ) => Promise<void>
  waitForRun: (entityUrl: string, timeoutMs?: number) => Promise<void>
  waitForSettled: (timeoutMs?: number) => Promise<void>
  waitForEvent: (
    entityUrl: string,
    predicate: (event: Record<string, unknown>) => boolean,
    timeoutMs?: number
  ) => Promise<Array<Record<string, unknown>>>
  readStream: (entityUrl: string) => Promise<Array<Record<string, unknown>>>
  readSharedState: (
    sharedStateId: string
  ) => Promise<Array<Record<string, unknown>>>
  expectWakeError: (
    matcher: string | RegExp | ((error: Error) => boolean)
  ) => void
  cleanup: () => Promise<void>
  getServerUrl: () => Promise<string>
}

interface ServerState {
  dsServer: DurableStreamTestServer
  electricAgentsServer: ElectricAgentsServerInstance
  handlerServer: http.Server
  runtime: RuntimeHandler
  electricAgentsUrl: string
  handlerUrl: string
}

const debugStartupTiming = process.env.ELECTRIC_AGENTS_DEBUG_TEST_TIMING === `1`

async function timeStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    if (debugStartupTiming) {
      process.stderr.write(
        `[agent-runtime][timing] ${label}: ${(performance.now() - start).toFixed(1)}ms\n`
      )
    }
  }
}

async function startServers(registry: EntityRegistry): Promise<ServerState> {
  const overallStart = performance.now()
  const [
    { TEST_ELECTRIC_URL, TEST_POSTGRES_URL, resetElectricAgentsTestBackend },
    ElectricAgentsServer,
  ] = await Promise.all([loadTestBackend(), loadElectricAgentsServer()])
  await timeStep(`resetElectricAgentsTestBackend`, () =>
    resetElectricAgentsTestBackend()
  )

  const dsServer = new DurableStreamTestServer({
    port: 0,
    webhooks: true,
  })
  await timeStep(`DurableStreamTestServer.start`, () => dsServer.start())

  const electricAgentsServer = new ElectricAgentsServer({
    durableStreamsUrl: dsServer.url,
    port: 0,
    postgresUrl: TEST_POSTGRES_URL,
    electricUrl: TEST_ELECTRIC_URL,
  })
  const electricAgentsUrl = await timeStep(`ElectricAgentsServer.start`, () =>
    electricAgentsServer.start()
  )

  const runtimeRef: { current: RuntimeHandler | null } = { current: null }

  const handlerServer = http.createServer(async (req, res) => {
    if (req.url === `/webhook` && req.method === `POST` && runtimeRef.current) {
      await runtimeRef.current.onEnter(req, res)
      return
    }
    res.writeHead(404)
    res.end()
  })

  const handlerUrl = await timeStep(
    `handlerServer.listen`,
    async () =>
      new Promise<string>((resolve, reject) => {
        handlerServer.on(`error`, reject)
        handlerServer.listen(0, `127.0.0.1`, () => {
          const addr = handlerServer.address()
          if (typeof addr === `object` && addr) {
            resolve(`http://127.0.0.1:${addr.port}`)
          } else {
            reject(new Error(`Could not determine handler server address`))
          }
        })
      })
  )

  const runtime = createRuntimeHandler({
    baseUrl: electricAgentsUrl,
    serveEndpoint: `${handlerUrl}/webhook`,
    registry,
    idleTimeout: 0,
    ...(process.env.ELECTRIC_AGENTS_TEST_REGISTRATION_CONCURRENCY
      ? {
          registrationConcurrency: Number.parseInt(
            process.env.ELECTRIC_AGENTS_TEST_REGISTRATION_CONCURRENCY,
            10
          ),
        }
      : {}),
  })
  runtimeRef.current = runtime

  await timeStep(`runtime.registerTypes`, () => runtime.registerTypes())

  if (debugStartupTiming) {
    process.stderr.write(
      `[agent-runtime][timing] startServers total: ${(performance.now() - overallStart).toFixed(1)}ms\n`
    )
  }

  return {
    dsServer,
    electricAgentsServer,
    handlerServer,
    runtime,
    electricAgentsUrl,
    handlerUrl,
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === `object` && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => pruneUndefined(item))
      .filter((item) => item !== undefined) as T
  }

  if (value && typeof value === `object`) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, pruneUndefined(item)])

    return Object.fromEntries(entries) as T
  }

  return value
}

function stripInternalFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripInternalFields(item))
  }

  if (value && typeof value === `object`) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== `_seq` && key !== `_offset`)
        .map(([key, item]) => [key, stripInternalFields(item)])
    )
  }

  return value
}

function eventOperation(event: RuntimeStreamEvent): string | undefined {
  return asRecord(event.headers)?.operation as string | undefined
}

function summarizeManifestEntry(entry: unknown): Record<string, unknown> {
  const manifestEntry = asRecord(entry) ?? {}
  const kind = manifestEntry.kind as string | undefined
  const key = manifestEntry.key as string | undefined

  switch (kind) {
    case `effect`:
      return pruneUndefined({
        kind,
        key,
        id: manifestEntry.id,
        functionRef: manifestEntry.function_ref,
        config: stripInternalFields(manifestEntry.config),
      })

    case `child`:
      return pruneUndefined({
        kind,
        key,
        id: manifestEntry.id,
        entityType: manifestEntry.entity_type,
        entityUrl: manifestEntry.entity_url,
        wake: stripInternalFields(manifestEntry.wake),
      })

    case `observe`:
      return pruneUndefined({
        kind,
        key,
        id: manifestEntry.id,
        entityUrl: manifestEntry.entity_url,
        wake: stripInternalFields(manifestEntry.wake),
      })

    case `shared-state`:
      return pruneUndefined({
        kind,
        key,
        id: manifestEntry.id,
        mode: manifestEntry.mode,
        collections: stripInternalFields(manifestEntry.collections),
        wake: stripInternalFields(manifestEntry.wake),
      })

    default:
      return pruneUndefined({
        kind,
        key,
        value: stripInternalFields(manifestEntry),
      })
  }
}

function summarizeEvent(event: RuntimeStreamEvent): RuntimeHistorySummaryEntry {
  const headers = asRecord(event.headers)
  const value = asRecord(event.value)
  const base = {
    operation: headers?.operation as string | undefined,
    type: event.type,
  }
  const keyedBase = {
    key: event.key,
    ...base,
  }

  switch (event.type) {
    case `entity_created`:
      return pruneUndefined({
        ...base,
        args: value?.args,
        entityType: value?.entity_type,
        parentUrl: value?.parent_url,
      })

    case `message_received`:
      return pruneUndefined({
        ...base,
        from: value?.from,
        messageType: value?.message_type,
        payload: value?.payload,
      })

    case `run`:
    case `step`:
    case `text`:
    case `reasoning`:
      return pruneUndefined({
        ...keyedBase,
        finishReason: value?.finish_reason,
        status: value?.status,
        stepNumber: value?.step_number,
      })

    case `text_delta`:
      return pruneUndefined({
        ...keyedBase,
        delta: value?.delta,
        runId: value?.run_id,
        textId: value?.text_id,
        reasoningId: value?.reasoning_id,
      })

    case `tool_call`:
      return pruneUndefined({
        ...keyedBase,
        args: value?.args,
        result: value?.result,
        status: value?.status,
        toolName: value?.tool_name,
      })

    case `error`:
      return pruneUndefined({
        ...keyedBase,
        errorCode: value?.error_code,
        message: value?.message,
      })

    case `entity_stopped`:
      return pruneUndefined({
        ...keyedBase,
        reason: value?.reason,
      })

    case `child_status`:
      return pruneUndefined({
        ...keyedBase,
        entityType: value?.entity_type,
        entityUrl: value?.entity_url,
        status: value?.status,
      })

    case `manifest`:
      return pruneUndefined({
        ...keyedBase,
        manifest: summarizeManifestEntry(value),
      })

    case `replay_watermark`:
      return pruneUndefined({
        ...base,
        offset: value?.offset,
      })

    default:
      return pruneUndefined({
        ...keyedBase,
        value: stripInternalFields(event.value),
      })
  }
}

export function runtimeTest(): RuntimeTestBuilder {
  const registry = createEntityRegistry()
  let serverState: ServerState | null = null
  let serverClient: ReturnType<typeof createRuntimeServerClient> | null = null
  const expectedWakeErrors: Array<(error: Error) => boolean> = []

  async function ensureServer(): Promise<ServerState> {
    if (!serverState) {
      serverState = await startServers(registry)
    }
    return serverState
  }

  async function ensureClient(): Promise<
    ReturnType<typeof createRuntimeServerClient>
  > {
    if (!serverClient) {
      const { electricAgentsUrl } = await ensureServer()
      serverClient = createRuntimeServerClient({ baseUrl: electricAgentsUrl })
    }
    return serverClient
  }

  async function drainRuntimeWakes(): Promise<void> {
    const { runtime } = await ensureServer()

    try {
      await runtime.drainWakes()
      if (expectedWakeErrors.length > 0) {
        throw new Error(
          `Expected ${expectedWakeErrors.length} wake error(s), but runtime drained cleanly`
        )
      }
    } catch (error) {
      const actualErrors =
        error instanceof AggregateError
          ? error.errors.map((item) =>
              item instanceof Error ? item : new Error(String(item))
            )
          : [error instanceof Error ? error : new Error(String(error))]
      const remainingMatchers = [...expectedWakeErrors]
      expectedWakeErrors.length = 0
      const unexpectedErrors: Array<Error> = []

      for (const actualError of actualErrors) {
        const matcherIndex = remainingMatchers.findIndex((matcher) =>
          matcher(actualError)
        )
        if (matcherIndex === -1) {
          unexpectedErrors.push(actualError)
          continue
        }
        remainingMatchers.splice(matcherIndex, 1)
      }

      if (remainingMatchers.length > 0) {
        throw new Error(
          `Expected ${remainingMatchers.length} additional wake error(s), but they did not occur`
        )
      }

      if (unexpectedErrors.length === 1) {
        throw unexpectedErrors[0]!
      }
      if (unexpectedErrors.length > 1) {
        throw new AggregateError(
          unexpectedErrors,
          `[agent-runtime] Unexpected background wake failures`
        )
      }
    }
  }

  async function waitForRuntimeSettled(timeoutMs = 30_000): Promise<void> {
    await ensureServer()

    const settled = drainRuntimeWakes()
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`Timeout (${timeoutMs}ms) waiting for runtime to settle`)
          ),
        timeoutMs
      )
    })
    await Promise.race([settled, timeout])
  }

  async function readPath(
    path: string
  ): Promise<Array<Record<string, unknown>>> {
    const { electricAgentsUrl } = await ensureServer()
    const url = new URL(`${electricAgentsUrl}${path}`)
    url.searchParams.set(`offset`, `-1`)
    url.searchParams.set(`live`, `false`)

    const res = await fetch(url)
    if (res.status === 204 || res.status === 404) return []
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Failed to read ${path}: ${res.status} ${text}`)
    }

    const text = await res.text()
    if (!text) return []

    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  }

  async function waitForHistory(
    label: string,
    path: string,
    predicate: (history: StreamHistory) => boolean,
    timeoutMs = 30_000
  ): Promise<StreamHistory> {
    const started = Date.now()
    let lastHistory = new StreamHistory(await readPath(path))

    while (Date.now() - started < timeoutMs) {
      if (predicate(lastHistory)) {
        return lastHistory
      }

      await new Promise((resolve) => setTimeout(resolve, 25))
      lastHistory = new StreamHistory(await readPath(path))
    }

    throw new Error(
      `Timeout (${timeoutMs}ms) waiting for ${label}\n${JSON.stringify(
        lastHistory.snapshot(),
        null,
        2
      )}`
    )
  }

  function buildEntityRef(entityUrl: string): RuntimeEntityRef {
    let infoPromise: Promise<{
      streamPath: string
      entityType?: string
      entityUrl: string
    }> | null = null
    let lastObservedCompletedRunCount = 0

    const getInfo = () => {
      if (!infoPromise) {
        infoPromise = ensureClient().then((client) =>
          client.getEntityInfo(entityUrl)
        )
      }
      return infoPromise
    }

    const history = async () =>
      new StreamHistory(await readPath((await getInfo()).streamPath))

    return {
      entityUrl,

      send(payload: unknown, opts?: { from?: string; type?: string }) {
        return builder.send(entityUrl, payload, opts)
      },

      history,

      async snapshot() {
        return (await history()).snapshot()
      },

      waitFor(predicate, timeoutMs) {
        return getInfo().then((info) =>
          waitForHistory(
            `entity history on ${entityUrl}`,
            info.streamPath,
            predicate,
            timeoutMs
          )
        )
      },

      waitForTypeCount(
        type: string,
        count: number,
        opts?: {
          timeoutMs?: number
          predicate?: (event: RuntimeStreamEvent) => boolean
        }
      ) {
        return getInfo().then((info) =>
          waitForHistory(
            `${type} x${count} on ${entityUrl}`,
            info.streamPath,
            (streamHistory) =>
              streamHistory.count(type, opts?.predicate) >= count,
            opts?.timeoutMs
          )
        )
      },

      waitForOperation(
        type: string,
        operation: string,
        opts?: {
          count?: number
          timeoutMs?: number
          predicate?: (event: RuntimeStreamEvent) => boolean
        }
      ) {
        return getInfo().then((info) =>
          waitForHistory(
            `${type} operation=${operation} x${opts?.count ?? 1} on ${entityUrl}`,
            info.streamPath,
            (streamHistory) =>
              streamHistory.count(
                type,
                (event) =>
                  eventOperation(event) === operation &&
                  (!opts?.predicate || opts.predicate(event))
              ) >= (opts?.count ?? 1),
            opts?.timeoutMs
          )
        )
      },

      waitForRun(timeoutMs) {
        return timeStep(`entity.waitForRun ${entityUrl}`, async () =>
          getInfo().then(async (info) => {
            const currentHistory = await history()
            const targetCompletedRunCount = Math.max(
              lastObservedCompletedRunCount + 1,
              currentHistory.completedRunCount()
            )
            const resolvedHistory = await waitForHistory(
              `completed run on ${entityUrl}`,
              info.streamPath,
              (streamHistory) =>
                streamHistory.completedRunCount() >= targetCompletedRunCount,
              timeoutMs
            )
            lastObservedCompletedRunCount = Math.max(
              lastObservedCompletedRunCount,
              resolvedHistory.completedRunCount()
            )
            return resolvedHistory
          })
        )
      },

      waitForRunCount(count: number, timeoutMs?: number) {
        return getInfo().then(async (info) => {
          const resolvedHistory = await waitForHistory(
            `completed runs=${count} on ${entityUrl}`,
            info.streamPath,
            (streamHistory) => streamHistory.completedRunCount() >= count,
            timeoutMs
          )
          lastObservedCompletedRunCount = Math.max(
            lastObservedCompletedRunCount,
            resolvedHistory.completedRunCount()
          )
          return resolvedHistory
        })
      },

      async waitForSettled(timeoutMs?: number) {
        await waitForRuntimeSettled(timeoutMs)
        return history()
      },
    }
  }

  function buildSharedStateRef(sharedStateId: string): RuntimeSharedStateRef {
    const history = async () =>
      new StreamHistory(await readPath(getSharedStateStreamPath(sharedStateId)))

    return {
      sharedStateId,

      history,

      async snapshot() {
        return (await history()).snapshot()
      },

      waitFor(predicate, timeoutMs) {
        return waitForHistory(
          `shared state history on ${sharedStateId}`,
          getSharedStateStreamPath(sharedStateId),
          predicate,
          timeoutMs
        )
      },

      waitForTypeCount(
        type: string,
        count: number,
        opts?: {
          timeoutMs?: number
          predicate?: (event: RuntimeStreamEvent) => boolean
        }
      ) {
        return waitForHistory(
          `${type} x${count} on shared state ${sharedStateId}`,
          getSharedStateStreamPath(sharedStateId),
          (streamHistory) =>
            streamHistory.count(type, opts?.predicate) >= count,
          opts?.timeoutMs
        )
      },

      waitForOperation(
        type: string,
        operation: string,
        opts?: {
          count?: number
          timeoutMs?: number
          predicate?: (event: RuntimeStreamEvent) => boolean
        }
      ) {
        return waitForHistory(
          `${type} operation=${operation} x${opts?.count ?? 1} on shared state ${sharedStateId}`,
          getSharedStateStreamPath(sharedStateId),
          (streamHistory) =>
            streamHistory.count(
              type,
              (event) =>
                eventOperation(event) === operation &&
                (!opts?.predicate || opts.predicate(event))
            ) >= (opts?.count ?? 1),
          opts?.timeoutMs
        )
      },

      async waitForSettled(timeoutMs?: number) {
        await waitForRuntimeSettled(timeoutMs)
        return history()
      },
    }
  }

  const builder: RuntimeTestBuilder = {
    define(name: string, definition: EntityDefinition) {
      registry.define(name, definition as unknown as EntityDefinition)
      return builder
    },

    async prepare() {
      await ensureServer()
    },

    async spawn(
      typeName: string,
      instanceId: string,
      args?: Record<string, unknown>,
      opts?: { initialMessage?: unknown }
    ) {
      const client = await ensureClient()
      const entity = await timeStep(`spawn ${typeName}/${instanceId}`, () =>
        client.spawnEntity({
          type: typeName,
          id: instanceId,
          args,
          initialMessage: opts?.initialMessage,
        })
      )
      return buildEntityRef(entity.entityUrl)
    },

    entity(entityUrl: string) {
      return buildEntityRef(entityUrl)
    },

    sharedState(sharedStateId: string) {
      return buildSharedStateRef(sharedStateId)
    },

    async send(
      entityUrl: string,
      payload: unknown,
      opts?: { from?: string; type?: string }
    ) {
      const client = await ensureClient()
      await timeStep(`send ${entityUrl}`, () =>
        client.sendEntityMessage({
          targetUrl: entityUrl,
          payload,
          from: opts?.from,
          type: opts?.type,
        })
      )
    },

    async waitForRun(entityUrl: string, timeoutMs = 30_000) {
      await builder.entity(entityUrl).waitForRun(timeoutMs)
    },

    async waitForSettled(timeoutMs = 30_000) {
      await waitForRuntimeSettled(timeoutMs)
    },

    async waitForEvent(
      entityUrl: string,
      predicate: (event: Record<string, unknown>) => boolean,
      timeoutMs = 30_000
    ) {
      const history = await builder
        .entity(entityUrl)
        .waitFor(
          (streamHistory) => streamHistory.events.some(predicate),
          timeoutMs
        )
      return history.events
    },

    async readStream(entityUrl: string) {
      return (await builder.entity(entityUrl).history()).events
    },

    async readSharedState(sharedStateId: string) {
      return (await builder.sharedState(sharedStateId).history()).events
    },

    async getServerUrl() {
      const { electricAgentsUrl } = await ensureServer()
      return electricAgentsUrl
    },

    expectWakeError(matcher) {
      if (typeof matcher === `string`) {
        expectedWakeErrors.push((error) => error.message.includes(matcher))
        return
      }
      if (matcher instanceof RegExp) {
        expectedWakeErrors.push((error) => matcher.test(error.message))
        return
      }
      expectedWakeErrors.push(matcher)
    },

    async cleanup() {
      if (!serverState) return
      const debugCleanup = process.env.ELECTRIC_AGENTS_DEBUG_CLEANUP === `1`
      const cleanupStart = performance.now()

      if (debugCleanup) {
        console.error(`[agent-runtime][cleanup] aborting wakes`)
      }
      serverState.runtime.abortWakes()

      if (debugCleanup) {
        console.error(`[agent-runtime][cleanup] closing handler server`)
      }
      await new Promise<void>((resolve) => {
        const { handlerServer } = serverState!
        handlerServer.close(() => resolve())
        handlerServer.closeIdleConnections()
      })
      if (debugCleanup) {
        console.error(`[agent-runtime][cleanup] handler server closed`)
        console.error(`[agent-runtime][cleanup] draining wakes`)
      }

      await drainRuntimeWakes()
      if (debugCleanup) {
        console.error(`[agent-runtime][cleanup] wakes drained`)
      }
      if (debugCleanup) {
        console.error(
          `[agent-runtime][cleanup] stopping electric-agents server`
        )
      }
      await serverState.electricAgentsServer.stop()
      if (debugCleanup) {
        console.error(`[agent-runtime][cleanup] electric-agents server stopped`)
      }
      await serverState.dsServer.stop()
      if (debugStartupTiming) {
        process.stderr.write(
          `[agent-runtime][timing] cleanup total: ${(performance.now() - cleanupStart).toFixed(1)}ms\n`
        )
      }
      serverState = null
      serverClient = null
    },
  }

  return builder
}

export async function withTestServer(
  fn: (builder: RuntimeTestBuilder) => Promise<void>
): Promise<void> {
  const builder = runtimeTest()
  try {
    await fn(builder)
  } finally {
    await builder.cleanup()
  }
}
