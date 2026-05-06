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
}

export interface RegistryOpts {
  credentials: CredentialStore
  transportFactoryOverride?: (
    cfg: McpServerConfig,
    hp?: HeaderProvider
  ) => McpTransport
  /** Reserved for Phase 3 — supplies an OAuthClientProvider per server. */
  oauthProviderFactory?: (cfg: McpServerConfig) => unknown
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

export function createRegistry(opts: RegistryOpts): Registry {
  const entries = new Map<string, Entry>()

  const buildTransport = async (
    cfg: McpServerConfig
  ): Promise<{
    transport?: McpTransport
    error?: McpToolError
    authUrl?: string
  }> => {
    if (opts.transportFactoryOverride) {
      return { transport: opts.transportFactoryOverride(cfg) }
    }
    if (cfg.transport === `stdio`) {
      return {
        transport: createStdioTransport({
          name: cfg.name,
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
        }),
      }
    }
    if (cfg.auth.mode === `apiKey`) {
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
    return {
      error: makeError(
        `auth_unavailable`,
        `auth.mode=${cfg.auth.mode} not implemented in Phase 1`
      ),
    }
  }

  const connectAndList = async (entry: Entry): Promise<AddServerResult> => {
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
      }
      entries.set(cfg.name, entry)
      if (built.error)
        return { state: `error`, id: cfg.name, error: built.error }
      if (built.authUrl) {
        entry.status = `authenticating`
        return { state: `authenticating`, id: cfg.name, authUrl: built.authUrl }
      }
      return await connectAndList(entry)
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
  }

  return registry
}
