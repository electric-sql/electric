import type {
  AddServerResult,
  McpServerConfig,
  McpServerStatus,
  McpToolError,
} from './types'
import { createAuthStore } from './credentials/auth-store'
import type { InternalAuthStore } from './credentials/auth-store'
import type { McpTransport } from './transports/types'
import { createHttpTransport } from './transports/http'
import { createStdioTransport } from './transports/stdio'
import { buildApiKeyHeader } from './auth/api-key'
import { createSdkOAuthProvider } from './auth/sdk-provider'
import type { SdkOAuthProvider } from './auth/sdk-provider'
import { createClientCredentialsProvider } from './auth/client-credentials'
import type { McpConfig } from './config/loader'

interface Entry {
  config: McpServerConfig
  configHash: string
  status: McpServerStatus
  error?: McpToolError
  authUrl?: string
  transport?: McpTransport
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>
  capabilities?: unknown
  provider?: SdkOAuthProvider
}

export interface RegistryOpts {
  /** Base URL of this registry process, used to construct OAuth redirect URIs. */
  publicUrl?: string
  transportFactoryOverride?: (
    cfg: McpServerConfig,
    hp?: HeaderProvider,
    provider?: SdkOAuthProvider
  ) => McpTransport
  /**
   * Called when an authorizationCode-flow server first needs the user
   * to consent — receives the SDK-generated authorize URL plus the
   * server name. The default implementation logs the URL; the desktop
   * app overrides this to open the URL in a sandboxed BrowserWindow
   * (and intercept the redirect_uri navigation to call `finishAuth`).
   *
   * Headless / non-Electron embedders that want to drive the flow
   * themselves can read the URL from the `authenticating` envelope of
   * `addServer` instead — this hook is purely a convenience for
   * "open this URL right now" callers.
   */
  openAuthorizeUrl?: (url: string, server: string) => void
  /**
   * Internal hook used by tests to seed / inspect the registry's private
   * auth store. Not part of the public contract — production callers should
   * use the per-server `auth.tokens` / `auth.client` fields and the
   * `onTokensChanged` / `onClientRegistered` hooks instead.
   * @internal
   */
  authStore?: InternalAuthStore
}

export type HeaderProvider = () => Promise<
  { name: string; value: string } | undefined
>

export interface ListedEntry {
  name: string
  status: McpServerStatus
  toolCount: number
  /** `http` or `stdio`. Surfaces in UI for badges + per-status affordances. */
  transport?: string
  /** `none` | `apiKey` | `clientCredentials` | `authorizationCode`. */
  authMode?: string
  authUrl?: string
  error?: McpToolError
  tools: Entry[`tools`]
  capabilities?: unknown
}

/** State snapshot delivered to subscribers on every registry mutation. */
export interface RegistrySnapshot {
  /** Monotonic per-registry counter; useful for detecting dropped events. */
  seq: number
  servers: ReadonlyArray<ListedEntry>
}

export type RegistrySubscriber = (snapshot: RegistrySnapshot) => void

export interface Registry {
  addServer(cfg: McpServerConfig): Promise<AddServerResult>
  applyConfig(cfg: McpConfig): Promise<AddServerResult[]>
  removeServer(name: string): Promise<void>
  list(): ReadonlyArray<ListedEntry>
  get(name: string): Entry | undefined
  finishAuth(
    serverName: string,
    code: string,
    state?: string
  ): Promise<AddServerResult>
  disable(name: string): Promise<void>
  enable(name: string): Promise<AddServerResult>
  /**
   * Force a fresh OAuth flow for a server. Closes the current transport,
   * forgets cached tokens (and DCR client info) for this server, and
   * rebuilds the transport in place — keeping the entry visible in
   * snapshots throughout, so renderers don't see a brief
   * "server gone, server back" blip the way `removeServer` + `addServer`
   * would. The SDK provider then has nothing to authenticate with on the
   * next connect, and surfaces a fresh authorize URL via the
   * `openAuthorizeUrl` hook.
   *
   * No-op when the server is unknown, not authorizationCode, or
   * disabled.
   */
  reauthorize(name: string): Promise<void>
  /**
   * Subscribe to registry state changes. The handler is invoked
   * synchronously with the current snapshot on subscribe (so callers
   * can render an initial UI without a round-trip), and again on every
   * mutation: addServer / removeServer / applyConfig / finishAuth /
   * disable / enable / connection-state transitions.
   *
   * Returns an unsubscribe function.
   */
  subscribe(handler: RegistrySubscriber): () => void
  /**
   * Close every transport, clear all entries, and emit a final empty
   * snapshot to subscribers.
   */
  close(): Promise<void>
}

function hashConfig(c: McpServerConfig): string {
  const parts = [
    c.name,
    c.transport,
    (c as any).url ?? ``,
    c.auth?.mode ?? `none`,
    String(c.timeoutMs ?? ``),
  ]
  if (
    c.auth &&
    (c.auth.mode === `authorizationCode` || c.auth.mode === `clientCredentials`)
  ) {
    parts.push((c.auth.scopes ?? []).slice().sort().join(`,`))
  }
  if (c.transport === `stdio`) {
    parts.push(c.command, (c.args ?? []).join(` `))
  }
  return parts.join(`|`)
}

function makeError(kind: McpToolError[`kind`], message: string): McpToolError {
  return { kind, message }
}

interface BuildTransportResult {
  transport?: McpTransport
  error?: McpToolError
  authUrl?: string
  provider?: SdkOAuthProvider
}

export function createRegistry(opts: RegistryOpts): Registry {
  const entries = new Map<string, Entry>()

  // Per-registry private auth state. Holds OAuth tokens + DCR client info
  // for the lifetime of this registry. Cross-process persistence (if any)
  // is the operator's choice via the per-server hooks declared on the
  // auth config.
  const authStore = opts.authStore ?? createAuthStore()

  const buildTransport = async (
    cfg: McpServerConfig
  ): Promise<BuildTransportResult> => {
    if (cfg.transport === `stdio`) {
      if (opts.transportFactoryOverride) {
        return { transport: opts.transportFactoryOverride(cfg) }
      }
      return {
        transport: createStdioTransport({
          name: cfg.name,
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
        }),
      }
    }

    // HTTP transport from here on
    if (cfg.auth.mode === `none`) {
      if (opts.transportFactoryOverride) {
        return { transport: opts.transportFactoryOverride(cfg) }
      }
      return {
        transport: createHttpTransport({ name: cfg.name, url: cfg.url }),
      }
    }

    if (cfg.auth.mode === `apiKey`) {
      if (opts.transportFactoryOverride) {
        return { transport: opts.transportFactoryOverride(cfg) }
      }
      if (!cfg.auth.key) {
        return {
          error: makeError(
            `auth_unavailable`,
            `no auth.key for ${cfg.name} (apiKey mode requires the secret inline)`
          ),
        }
      }
      const header = buildApiKeyHeader(cfg.auth.key, {
        headerName: cfg.auth.headerName,
        valuePrefix: cfg.auth.valuePrefix,
      })
      const headerProvider: HeaderProvider = async () => header
      return {
        transport: createHttpTransport({
          name: cfg.name,
          url: cfg.url,
          headerProvider,
        }),
      }
    }

    if (cfg.auth.mode === `authorizationCode`) {
      const publicUrl = opts.publicUrl ?? `http://localhost`
      const provider = createSdkOAuthProvider({
        server: cfg.name,
        publicUrl,
        authStore,
        scopes: cfg.auth.scopes,
        redirectUri: cfg.auth.redirectUri,
        resource: cfg.auth.resource,
      })
      if (opts.transportFactoryOverride) {
        return {
          transport: opts.transportFactoryOverride(cfg, undefined, provider),
          provider,
        }
      }
      return {
        transport: createHttpTransport({
          name: cfg.name,
          url: cfg.url,
          authProvider: provider,
        }),
        provider,
      }
    }

    if (cfg.auth.mode === `clientCredentials`) {
      if (!cfg.auth.clientId || !cfg.auth.clientSecret) {
        return {
          error: makeError(
            `auth_unavailable`,
            `clientCredentials mode requires auth.clientId and auth.clientSecret inline for ${cfg.name}`
          ),
        }
      }
      const ccProvider = createClientCredentialsProvider({
        tokenUrl: cfg.auth.tokenUrl,
        clientId: cfg.auth.clientId,
        clientSecret: cfg.auth.clientSecret,
        scopes: cfg.auth.scopes,
        audience: cfg.auth.audience,
        resource: cfg.auth.resource,
      })
      if (opts.transportFactoryOverride) {
        return {
          transport: opts.transportFactoryOverride(cfg, undefined, undefined),
        }
      }
      return {
        transport: createHttpTransport({
          name: cfg.name,
          url: cfg.url,
          authProvider: ccProvider,
        }),
      }
    }

    return {
      error: makeError(
        `auth_unavailable`,
        `auth.mode=${(cfg.auth as any).mode} not implemented`
      ),
    }
  }

  const connectAndList = async (
    entry: Entry,
    provider?: SdkOAuthProvider
  ): Promise<AddServerResult> => {
    if (!entry.transport) {
      return {
        state: `error`,
        id: entry.config.name,
        error: entry.error ?? makeError(`transport_error`, `no transport`),
      }
    }
    try {
      await entry.transport.connect()
      const out = await entry.transport.client.listTools()
      entry.tools = out.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
      entry.capabilities = (
        entry.transport.client as { getServerCapabilities?: () => unknown }
      ).getServerCapabilities?.()
      entry.status = `ready`
      notify()
      return {
        state: `ready`,
        id: entry.config.name,
        toolCount: entry.tools.length,
      }
    } catch (err) {
      // Check if an OAuth provider captured a redirect URL
      const authUrl = provider?.peekAuthUrl()
      if (authUrl) {
        entry.status = `authenticating`
        entry.authUrl = authUrl
        entry.provider = provider
        notify()
        try {
          opts.openAuthorizeUrl?.(authUrl, entry.config.name)
        } catch {
          // Operator-provided callback must not break the flow.
        }
        return { state: `authenticating`, id: entry.config.name, authUrl }
      }
      entry.status = `error`
      const e = makeError(`transport_error`, (err as Error).message)
      entry.error = e
      notify()
      return { state: `error`, id: entry.config.name, error: e }
    }
  }

  // ── State-change emitter ─────────────────────────────────────────
  // Per-registry monotonic seq + handler set. notify() pulls the latest
  // list() and fans it out to every subscriber. Each mutation site
  // (addServer / removeServer / applyConfig / finishAuth / disable /
  // enable / status transitions during connectAndList) calls notify()
  // after committing its change.
  let seq = 0
  const subscribers = new Set<RegistrySubscriber>()
  const snapshot = (): RegistrySnapshot => ({
    seq: ++seq,
    servers: registry.list(),
  })
  const notify = (): void => {
    if (subscribers.size === 0) return
    const snap = snapshot()
    for (const h of subscribers) {
      try {
        h(snap)
      } catch {
        // A buggy subscriber must not break the registry.
      }
    }
  }

  const registry: Registry = {
    subscribe(handler) {
      subscribers.add(handler)
      // Synchronous initial delivery so callers can render without a
      // round-trip. The initial envelope always carries `seq: 0` as a
      // sentinel — emitted snapshots start at 1 and increase
      // monotonically. A late subscriber thus doesn't collide with the
      // last broadcast seq, and any downstream "skip if newSeq <= last"
      // logic safely treats the bootstrap as outside the event stream.
      try {
        handler({ seq: 0, servers: registry.list() })
      } catch {
        // ignored — see notify()
      }
      return () => {
        subscribers.delete(handler)
      }
    },

    async addServer(cfg) {
      const existing = entries.get(cfg.name)
      const hash = hashConfig(cfg)
      if (
        existing &&
        existing.configHash === hash &&
        existing.status === `ready`
      ) {
        return {
          state: `ready`,
          id: cfg.name,
          toolCount: existing.tools.length,
        }
      }
      // Replace the existing entry's value in place via `entries.set`
      // below — Map preserves insertion order so the row keeps its
      // position in `list()` snapshots.
      if (existing) {
        await Promise.resolve(existing.transport?.close()).catch(() => {})
      }

      if (cfg.auth?.mode === `authorizationCode`) {
        if (cfg.auth.tokens) authStore.seedTokens(cfg.name, cfg.auth.tokens)
        if (cfg.auth.client) authStore.seedClient(cfg.name, cfg.auth.client)
        authStore.registerHooks(cfg.name, {
          onTokensChanged: cfg.auth.onTokensChanged,
          onClientRegistered: cfg.auth.onClientRegistered,
        })
      }

      const built = await buildTransport(cfg)
      const entry: Entry = {
        config: cfg,
        configHash: hash,
        status: built.transport ? `connecting` : `error`,
        transport: built.transport,
        error: built.error,
        authUrl: built.authUrl,
        tools: [],
        provider: built.provider,
      }
      entries.set(cfg.name, entry)
      if (built.error) {
        notify()
        return { state: `error`, id: cfg.name, error: built.error }
      }
      if (built.authUrl) {
        entry.status = `authenticating`
        notify()
        try {
          opts.openAuthorizeUrl?.(built.authUrl, cfg.name)
        } catch {
          // see above
        }
        return { state: `authenticating`, id: cfg.name, authUrl: built.authUrl }
      }
      // connectAndList notifies internally on each status transition.
      return await connectAndList(entry, built.provider)
    },

    async applyConfig(cfg) {
      const seen = new Set(cfg.servers.map((s) => s.name))
      const results: AddServerResult[] = []
      for (const s of cfg.servers) results.push(await registry.addServer(s))
      for (const name of [...entries.keys()]) {
        if (!seen.has(name)) await registry.removeServer(name)
      }
      return results
    },

    async removeServer(name) {
      const e = entries.get(name)
      if (!e) return
      await Promise.resolve(e.transport?.close()).catch(() => {})
      entries.delete(name)
      authStore.forget(name)
      notify()
    },

    list() {
      return [...entries.values()].map((e) => ({
        name: e.config.name,
        status: e.status,
        toolCount: e.tools.length,
        transport: e.config.transport,
        authMode: (e.config as { auth?: { mode?: string } }).auth?.mode,
        authUrl: e.authUrl,
        error: e.error,
        tools: e.tools,
        capabilities: e.capabilities,
      }))
    },

    get(name) {
      return entries.get(name)
    },

    async finishAuth(serverName, code, _state) {
      const e = entries.get(serverName)
      if (!e) throw new Error(`unknown server "${serverName}"`)
      const provider = e.provider
      if (!provider)
        throw new Error(`server "${serverName}" has no OAuth provider`)
      // The MCP SDK's `auth` function handles the token exchange when
      // authorizationCode is provided. It needs the server URL to re-discover
      // the token endpoint.
      const serverUrl = (e.config as any).url as string | undefined
      if (!serverUrl)
        throw new Error(
          `server "${serverName}" has no URL — cannot complete token exchange`
        )
      const { auth } = await import(`@modelcontextprotocol/sdk/client/auth.js`)
      await auth(provider, { serverUrl, authorizationCode: code })
      provider.clearAuthUrl()
      return await registry.addServer(e.config)
    },

    async disable(name) {
      const e = entries.get(name)
      if (!e) throw new Error(`unknown server "${name}"`)
      await Promise.resolve(e.transport?.close()).catch(() => {})
      e.transport = undefined
      e.tools = []
      e.authUrl = undefined
      e.status = `disabled`
      e.error = undefined
      notify()
    },

    async enable(name) {
      const e = entries.get(name)
      if (!e) throw new Error(`unknown server "${name}"`)
      if (e.status !== `disabled`)
        return { state: `ready`, id: name, toolCount: e.tools.length }
      return await registry.addServer(e.config)
    },

    async reauthorize(name) {
      const e = entries.get(name)
      if (!e) return
      if (e.config.auth?.mode !== `authorizationCode`) return
      if (e.status === `disabled`) return
      await Promise.resolve(e.transport?.close()).catch(() => {})
      // Drop only tokens + DCR client cache; hooks stay registered.
      authStore.clearCredentials(name)
      e.status = `connecting`
      e.tools = []
      e.capabilities = undefined
      e.authUrl = undefined
      e.error = undefined
      notify()
      const built = await buildTransport(e.config)
      e.transport = built.transport
      e.error = built.error
      e.authUrl = built.authUrl
      e.provider = built.provider
      if (built.error || !built.transport) {
        e.status = `error`
        notify()
        return
      }
      if (built.authUrl) {
        e.status = `authenticating`
        notify()
        try {
          opts.openAuthorizeUrl?.(built.authUrl, name)
        } catch {
          // see notify()
        }
        return
      }
      // connectAndList notifies on its own status transitions, including
      // the peekAuthUrl → authenticating path that opens the browser.
      await connectAndList(e, built.provider)
    },

    async close() {
      const transports = [...entries.values()]
        .map((e) => e.transport)
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
      await Promise.all(
        transports.map((t) => Promise.resolve(t.close()).catch(() => {}))
      )
      for (const name of [...entries.keys()]) {
        authStore.forget(name)
      }
      entries.clear()
      notify()
    },
  }

  return registry
}
