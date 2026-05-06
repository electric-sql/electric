import { randomUUID } from 'node:crypto'
import { ProgressNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpConfig } from './config/loader'
import type { KeyVault } from './vault/types'
import type { McpServerConfig, McpServerStatus, ProgressEvent } from './types'
import type { McpTransportHandle } from './transports/types'
import { TimeoutError } from './transports/timeout'

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
   * Disable a server: closes its transport (which causes any in-flight
   * SDK requests to surface as aborted, prompting the SDK to send
   * `notifications/cancelled`) and flips its status to `disabled`.
   * Future `invokeMethod` calls against a disabled server will throw.
   */
  disable(name: string): void
  /**
   * Re-enable a previously disabled server. Status flips out of
   * `disabled`; the caller is responsible for re-applying config (or
   * calling `invokeMethod`, which lazily re-connects) to bring it back
   * online.
   */
  enable(name: string): void
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
      if (e.status === `disabled`) {
        throw new Error(`server is disabled: ${server}`)
      }
      if (!e.transport) throw new Error(`server not connected: ${server}`)
      if (!e.transport.client) {
        await e.transport.connect()
      }
      const client = e.transport.client
      if (!client) throw new Error(`transport not connected: ${server}`)

      // Drive cancellation via AbortSignal: when the timeout fires, we
      // abort the controller. The SDK's Protocol layer listens on the
      // signal and, on abort, sends `notifications/cancelled` with the
      // in-flight request id (per MCP spec) before rejecting our promise.
      // We then translate the abort into a `TimeoutError` so callers
      // continue to see a stable error type.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        switch (method) {
          case `tools/list`:
            return await client.listTools(undefined, {
              signal: controller.signal,
            })
          case `tools/call`: {
            // Inject a unique progressToken into `_meta`. The MCP server
            // may emit `notifications/progress` referencing this token;
            // the notification handler installed in `eagerConnect` fans
            // those out to `progressSubscribers`.
            const progressToken = randomUUID()
            const callArgs = args as {
              name: string
              arguments?: Record<string, unknown>
              _meta?: Record<string, unknown>
            }
            return await client.callTool(
              {
                name: callArgs.name,
                arguments: callArgs.arguments,
                _meta: { ...(callArgs._meta ?? {}), progressToken },
              },
              undefined,
              { signal: controller.signal }
            )
          }
          case `resources/list`:
            return await client.listResources(undefined, {
              signal: controller.signal,
            })
          case `resources/read`:
            return await client.readResource(args as { uri: string }, {
              signal: controller.signal,
            })
          case `prompts/list`:
            return await client.listPrompts(undefined, {
              signal: controller.signal,
            })
          case `prompts/get`:
            return await client.getPrompt(
              args as { name: string; arguments?: Record<string, string> },
              { signal: controller.signal }
            )
          default:
            throw new Error(`unsupported method: ${method}`)
        }
      } catch (err) {
        // Map AbortError (or any error following an aborted signal) to
        // TimeoutError so downstream handling stays consistent.
        if (controller.signal.aborted) {
          throw new TimeoutError(timeoutMs)
        }
        throw err
      } finally {
        clearTimeout(timer)
      }
    },

    disable(name: string): void {
      const entry = entries.get(name)
      if (!entry) return
      entry.status = `disabled`
      // Close the transport so any in-flight SDK requests' AbortSignals
      // fire as part of teardown — the SDK then emits
      // `notifications/cancelled` automatically per MCP spec.
      void entry.transport?.close().catch(() => {
        // Closing during disable is best-effort; ignore errors.
      })
    },

    enable(name: string): void {
      const entry = entries.get(name)
      if (!entry) return
      if (entry.status !== `disabled`) return
      // Re-enable: revert to `healthy` optimistically. The next
      // `invokeMethod` lazy-reconnects via `transport.connect()`.
      entry.status = `healthy`
    },

    subscribeToProgress(cb: (e: ProgressEvent) => void): () => void {
      progressSubscribers.add(cb)
      return () => {
        progressSubscribers.delete(cb)
      }
    },
  }
}
