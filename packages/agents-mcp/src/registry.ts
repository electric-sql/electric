import { randomUUID } from 'node:crypto'
import { ProgressNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpConfig } from './config/loader'
import type { KeyVault } from './vault/types'
import type { McpServerConfig, McpServerStatus, ProgressEvent } from './types'
import type { McpTransportHandle } from './transports/types'
import { withTimeout } from './transports/timeout'

export interface ServerEntry {
  name: string
  config: McpServerConfig
  status: McpServerStatus
  lastError?: string
  transport?: McpTransportHandle
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
  resources?: Array<{ uri: string; name?: string; mimeType?: string }>
  prompts?: Array<{
    name: string
    description?: string
    arguments?: Array<{
      name: string
      description?: string
      required?: boolean
    }>
  }>
}

export type GetAuthHeader = () => Promise<{
  name: string
  value: string
} | null>

export interface RegistryOpts {
  vault: KeyVault
  /** Builds a transport handle for a given server. Receives the resolved auth header (or null). */
  transportFactory: (
    name: string,
    cfg: McpServerConfig,
    getAuthHeader: GetAuthHeader
  ) => McpTransportHandle
}

export interface Registry {
  applyConfig(cfg: McpConfig): Promise<void>
  list(): ServerEntry[]
  get(name: string): ServerEntry | undefined
  invokeMethod(
    server: string,
    method: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<unknown>
  /**
   * Subscribe to progress events emitted by any connected MCP server.
   * Returns an unsubscribe function. Consumers (e.g. the agents-server-ui)
   * use this to render `notifications/progress` events on a timeline.
   */
  subscribeToProgress(cb: (e: ProgressEvent) => void): () => void
}

/**
 * Creates a registry that owns server lifecycle (connect/close), tool list
 * per server, status per server, and supports hot-reload via {@link applyConfig}.
 *
 * v1 supports `apiKey` auth. OAuth modes (`clientCredentials`,
 * `authorizationCode`) are recognized but enter `needs_auth` status until
 * Task 21 wires the OAuth flows.
 */
export function createRegistry(opts: RegistryOpts): Registry {
  const entries = new Map<string, ServerEntry>()
  const progressSubscribers = new Set<(e: ProgressEvent) => void>()

  function emitProgress(e: ProgressEvent): void {
    for (const cb of progressSubscribers) {
      try {
        cb(e)
      } catch {
        // Subscriber errors must not break the notification pipeline.
      }
    }
  }

  function buildAuthHeader(cfg: McpServerConfig): GetAuthHeader {
    return async () => {
      if (cfg.transport !== `http`) return null
      const auth = cfg.auth
      if (auth.mode === `apiKey`) {
        const value = await opts.vault.get(auth.valueRef)
        if (value === null) return null
        return { name: auth.headerName, value }
      }
      // OAuth modes: deferred to Task 21.
      return null
    }
  }

  async function resolveStatus(cfg: McpServerConfig): Promise<McpServerStatus> {
    if (cfg.transport === `stdio`) return `healthy`
    const auth = cfg.auth
    if (auth.mode === `apiKey`) {
      const value = await opts.vault.get(auth.valueRef)
      return value === null ? `needs_auth` : `healthy`
    }
    // clientCredentials / authorizationCode: defer to Task 21.
    return `needs_auth`
  }

  async function eagerConnect(entry: ServerEntry): Promise<void> {
    if (!entry.transport) return
    try {
      await entry.transport.connect()
      const client = entry.transport.client
      if (!client) {
        throw new Error(`transport.connect() did not populate client`)
      }
      // Wire `notifications/progress` -> ProgressEvent fan-out.
      // The SDK validates against `ProgressNotificationSchema`; we re-shape
      // the payload into our public `ProgressEvent` (tagged with the server
      // name so subscribers can demultiplex events from many servers).
      try {
        client.setNotificationHandler(ProgressNotificationSchema, (notif) => {
          emitProgress({
            server: entry.name,
            progressToken: notif.params.progressToken,
            progress: notif.params.progress,
            total: notif.params.total,
            message: notif.params.message,
          })
        })
      } catch {
        // Older SDK clients or test fakes may omit setNotificationHandler;
        // progress passthrough is best-effort.
      }
      const result = await client.listTools()
      entry.tools = (result.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
      // Resources are optional — many MCP servers don't expose them. Failures
      // here should not flip status to `error`; just leave `resources`
      // undefined.
      try {
        const res = await client.listResources()
        entry.resources = (res.resources ?? []).map((r) => ({
          uri: r.uri,
          name: r.name,
          mimeType: r.mimeType,
        }))
      } catch {
        entry.resources = undefined
      }
      // Prompts are also optional — many MCP servers don't expose them.
      // Failures here should not flip status to `error`; just leave
      // `prompts` undefined.
      try {
        const pr = await client.listPrompts()
        entry.prompts = (pr.prompts ?? []).map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments?.map((a) => ({
            name: a.name,
            description: a.description,
            required: a.required,
          })),
        }))
      } catch {
        entry.prompts = undefined
      }
    } catch (err) {
      entry.status = `error`
      entry.lastError = err instanceof Error ? err.message : String(err)
      entry.tools = undefined
      entry.resources = undefined
      entry.prompts = undefined
    }
  }

  return {
    async applyConfig(cfg: McpConfig): Promise<void> {
      const nextNames = new Set(Object.keys(cfg.servers))

      // Remove servers no longer in config.
      for (const [name, entry] of entries) {
        if (!nextNames.has(name)) {
          try {
            await entry.transport?.close()
          } catch {
            // ignore close errors during teardown
          }
          entries.delete(name)
        }
      }

      // Add/replace servers.
      for (const [name, serverCfg] of Object.entries(cfg.servers)) {
        const existing = entries.get(name)
        if (existing) {
          try {
            await existing.transport?.close()
          } catch {
            // ignore close errors during replace
          }
        }

        const getAuthHeader = buildAuthHeader(serverCfg)
        const transport = opts.transportFactory(name, serverCfg, getAuthHeader)
        const status = await resolveStatus(serverCfg)
        const entry: ServerEntry = {
          name,
          config: serverCfg,
          status,
          transport,
        }
        entries.set(name, entry)

        if (status === `healthy`) {
          await eagerConnect(entry)
        }
      }
    },

    list(): ServerEntry[] {
      return Array.from(entries.values())
    },

    get(name: string): ServerEntry | undefined {
      return entries.get(name)
    },

    async invokeMethod(
      server: string,
      method: string,
      args: Record<string, unknown>,
      timeoutMs: number
    ): Promise<unknown> {
      const e = entries.get(server)
      if (!e) throw new Error(`unknown server: ${server}`)
      if (!e.transport) throw new Error(`server not connected: ${server}`)
      if (!e.transport.client) {
        await e.transport.connect()
      }
      const client = e.transport.client
      if (!client) throw new Error(`transport not connected: ${server}`)

      switch (method) {
        case `tools/list`:
          return withTimeout(client.listTools(), timeoutMs)
        case `tools/call`: {
          // Inject a unique progressToken into `_meta`. The MCP server may
          // emit `notifications/progress` referencing this token; the
          // notification handler installed in `eagerConnect` fans those out
          // to `progressSubscribers`.
          const progressToken = randomUUID()
          const callArgs = args as {
            name: string
            arguments?: Record<string, unknown>
            _meta?: Record<string, unknown>
          }
          return withTimeout(
            client.callTool({
              name: callArgs.name,
              arguments: callArgs.arguments,
              _meta: { ...(callArgs._meta ?? {}), progressToken },
            }),
            timeoutMs
          )
        }
        case `resources/list`:
          return withTimeout(client.listResources(), timeoutMs)
        case `resources/read`:
          return withTimeout(
            client.readResource(args as { uri: string }),
            timeoutMs
          )
        case `prompts/list`:
          return withTimeout(client.listPrompts(), timeoutMs)
        case `prompts/get`:
          return withTimeout(
            client.getPrompt(
              args as { name: string; arguments?: Record<string, string> }
            ),
            timeoutMs
          )
        default:
          throw new Error(`unsupported method: ${method}`)
      }
    },

    subscribeToProgress(cb: (e: ProgressEvent) => void): () => void {
      progressSubscribers.add(cb)
      return () => {
        progressSubscribers.delete(cb)
      }
    },
  }
}
