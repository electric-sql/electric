import type {
  AddServerResult,
  McpServerConfig,
  McpServerStatus,
  McpToolError,
} from './types'
import type { CredentialStore } from './credentials/types'
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
  credentials: CredentialStore
  /** Base URL of this registry process, used to construct OAuth redirect URIs. */
  publicUrl?: string
  transportFactoryOverride?: (
    cfg: McpServerConfig,
    hp?: HeaderProvider,
    provider?: SdkOAuthProvider
  ) => McpTransport
}

export type HeaderProvider = () => Promise<
  { name: string; value: string } | undefined
>

export interface ListedEntry {
  name: string
  status: McpServerStatus
  toolCount: number
  authUrl?: string
  error?: McpToolError
  tools: Entry[`tools`]
  capabilities?: unknown
}

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
}

function hashConfig(c: McpServerConfig): string {
  const parts = [
    c.name,
    c.transport,
    (c as any).url ?? ``,
    c.auth?.mode ?? `none`,
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
      const key = await opts.credentials.getApiKey?.(cfg.name)
      if (!key)
        return {
          error: makeError(`auth_unavailable`, `no apiKey for ${cfg.name}`),
        }
      const header = buildApiKeyHeader(key, {
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
        credentials: opts.credentials,
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
      const cc = await opts.credentials.getClientCredentials?.(cfg.name)
      if (!cc) {
        return {
          error: makeError(
            `auth_unavailable`,
            `no clientCredentials for ${cfg.name}`
          ),
        }
      }
      const ccProvider = createClientCredentialsProvider({
        tokenUrl: cfg.auth.tokenUrl,
        clientId: cc.clientId,
        clientSecret: cc.clientSecret,
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
        return { state: `authenticating`, id: entry.config.name, authUrl }
      }
      entry.status = `error`
      const e = makeError(`transport_error`, (err as Error).message)
      entry.error = e
      return { state: `error`, id: entry.config.name, error: e }
    }
  }

  const registry: Registry = {
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
      if (existing) {
        await Promise.resolve(existing.transport?.close()).catch(() => {})
        entries.delete(cfg.name)
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
      if (built.error)
        return { state: `error`, id: cfg.name, error: built.error }
      if (built.authUrl) {
        entry.status = `authenticating`
        return { state: `authenticating`, id: cfg.name, authUrl: built.authUrl }
      }
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
    },

    list() {
      return [...entries.values()].map((e) => ({
        name: e.config.name,
        status: e.status,
        toolCount: e.tools.length,
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
      // (Phase 5: e.deviceHandle?.cancel(); e.deviceHandle = undefined;)
      e.authUrl = undefined
      e.status = `disabled`
      e.error = undefined
    },

    async enable(name) {
      const e = entries.get(name)
      if (!e) throw new Error(`unknown server "${name}"`)
      if (e.status !== `disabled`)
        return { state: `ready`, id: name, toolCount: e.tools.length }
      entries.delete(name)
      return await registry.addServer(e.config)
    },
  }

  return registry
}
