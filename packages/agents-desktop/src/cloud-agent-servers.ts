import { ShapeStream, type Message, type Row } from '@electric-sql/client'
import type { CloudAuth } from './cloud-auth'
import { getCloudAgentsBaseUrl, getCloudBaseUrl } from './cloud-auth'
import type { SecretStore } from './secret-store'
import { Buffer } from 'node:buffer'

/**
 * Per-tenant token storage prefix. Each cloud agent server's agents
 * bearer token is persisted under `${TOKEN_REF_PREFIX}<tenantId>` in the
 * encrypted SecretStore so the token never lands in `settings.json`
 * (which lives in cleartext under `app.getPath('userData')`). The
 * webRequest hook in `main.ts` reads from the same map at injection
 * time, so we don't have to read from disk on every request.
 */
const TOKEN_REF_PREFIX = `cloud-agents-token:`
const AGENTS_TOKEN_EXPIRY_SKEW_MS = 60_000

/**
 * Cloud agent-servers state machine.
 *
 * Subscribes to four admin-API shapes — `agent-servers`, `environments`,
 * `projects`, `workspaces` — over the authenticated cloud-auth JWT and
 * keeps a continuously-synced, denormalized view in memory:
 *
 *   {
 *     id: <stream_services.id (tenant id)>,
 *     name,
 *     workspaceId, workspaceName,
 *     projectId,   projectName,
 *     environmentId, environmentName,
 *     updatedAt,
 *   }
 *
 * Renderers receive snapshots through `desktop:cloud-agent-servers-state-changed`
 * and on demand via `desktop:cloud-agent-servers-state`. The class isn't
 * a hook — `main.ts` owns the singleton and lets `CloudAuthState`
 * changes drive `start()` / `stop()`.
 *
 * Errors are surfaced through `state.error`; transient network / 5xx
 * failures keep the previous rows visible until the next successful
 * shape poll re-populates them. 401/403 stops the streams so the caller
 * can sign the user out without churning on a dead JWT.
 */

export type CloudAgentServer = {
  /** stream_services.id — also the tenant identifier in the cloud agents server. */
  id: string
  name: string
  workspaceId: string | null
  workspaceName: string | null
  projectId: string | null
  projectName: string | null
  environmentId: string | null
  environmentName: string | null
  updatedAt: string | null
}

export type CloudAgentServersStatus =
  | `idle`
  | `loading`
  | `ready`
  | `unauthorized`
  | `error`

export type CloudAgentServersState = {
  status: CloudAgentServersStatus
  servers: ReadonlyArray<CloudAgentServer>
  error: string | null
}

type AgentServerRow = {
  id: string
  name: string
  environment_id: string
  type: string
  variant: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

type EnvironmentRow = {
  id: string
  name: string
  project_id: string
  deleted_at?: string | null
}

type ProjectRow = {
  id: string
  name: string
  workspace_id: string
  deleted_at?: string | null
}

type WorkspaceRow = {
  id: string
  name: string
  deleted_at?: string | null
}

type StreamHandle = {
  stream: ShapeStream
  rows: Map<string, Row>
  unsubscribe: () => void
}

const SHAPE_PATHS = {
  agentServers: `/api/internal/v1/agent-servers`,
  environments: `/api/internal/v1/environments`,
  projects: `/api/internal/v1/projects`,
  workspaces: `/api/internal/v1/workspaces`,
} as const

const EMPTY_STATE: CloudAgentServersState = {
  status: `idle`,
  servers: [],
  error: null,
}

export class CloudAgentServers {
  private state: CloudAgentServersState = EMPTY_STATE
  private listeners = new Set<(state: CloudAgentServersState) => void>()
  private streams: {
    agentServers: StreamHandle | null
    environments: StreamHandle | null
    projects: StreamHandle | null
    workspaces: StreamHandle | null
  } = {
    agentServers: null,
    environments: null,
    projects: null,
    workspaces: null,
  }
  private currentToken: string | null = null
  /**
   * Cache of `tenantId → agents bearer token` hydrated from `SecretStore` at
   * launch and topped up by `prepareConnection`. `main.ts` reads
   * straight from this map inside the webRequest hook so per-request
   * auth injection stays synchronous.
   */
  private agentsTokens = new Map<string, string>()
  private tokensLoaded = false

  constructor(
    private readonly cloudAuth: CloudAuth,
    private readonly secretStore: SecretStore
  ) {}

  /** Synchronous lookup used by the main-process webRequest hook. */
  getAgentsToken(tenantId: string): string | undefined {
    const token = this.agentsTokens.get(tenantId)
    if (!token) return undefined
    return isExpiredJwt(token, AGENTS_TOKEN_EXPIRY_SKEW_MS) ? undefined : token
  }

  /**
   * Hydrate the in-memory agents-token cache from `SecretStore`.
   * Called on app launch with the set of tenant IDs that already
   * appear in `settings.json` (i.e. cloud servers the user has
   * connected to before). Missing entries are silently skipped — the
   * `webRequest` hook fails the request when no token is available
   * for a known cloud server, and the renderer surfaces a re-connect
   * prompt rather than us guessing.
   */
  async hydrateTokens(tenantIds: ReadonlyArray<string>): Promise<void> {
    if (this.tokensLoaded) return
    this.tokensLoaded = true
    for (const tenantId of tenantIds) {
      const stored = await this.secretStore.get(
        `${TOKEN_REF_PREFIX}${tenantId}`
      )
      if (!stored) continue
      if (isExpiredJwt(stored, AGENTS_TOKEN_EXPIRY_SKEW_MS)) {
        await this.secretStore.delete(`${TOKEN_REF_PREFIX}${tenantId}`)
        continue
      }
      this.agentsTokens.set(tenantId, stored)
    }
  }

  /** Drop the cached + persisted agents token for a tenant. */
  async forgetAgentsToken(tenantId: string): Promise<void> {
    this.agentsTokens.delete(tenantId)
    await this.secretStore.delete(`${TOKEN_REF_PREFIX}${tenantId}`)
  }

  getState(): CloudAgentServersState {
    return this.state
  }

  subscribe(listener: (state: CloudAgentServersState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * (Re)start the four shape streams using the latest token from
   * `CloudAuth`. Safe to call repeatedly — tears down prior streams
   * first. Called by `main.ts` whenever cloud-auth flips to
   * `signed-in` (and on app launch when a session restores).
   */
  async start(): Promise<void> {
    const token = await this.cloudAuth.getToken()
    if (!token) {
      await this.stop()
      return
    }
    // Same token? Already running — nothing to do.
    if (this.currentToken === token && this.streams.agentServers) return
    await this.stop()
    this.currentToken = token
    this.setState({ status: `loading`, servers: [], error: null })

    try {
      this.streams.agentServers = this.openStream(
        SHAPE_PATHS.agentServers,
        token
      )
      this.streams.environments = this.openStream(
        SHAPE_PATHS.environments,
        token
      )
      this.streams.projects = this.openStream(SHAPE_PATHS.projects, token)
      this.streams.workspaces = this.openStream(SHAPE_PATHS.workspaces, token)
    } catch (err) {
      this.setState({
        status: `error`,
        servers: [],
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Prepare a connection for a cloud agent server.
   *
   * Fetches a per-service principal token via `getTokenForAgents` on the
   * admin-API (authenticated with the user's cloud-auth bearer),
   * stores it in `SecretStore` and the in-memory cache, and returns
   * a tenant-scoped agents URL + tenant id to the renderer. The token
   * itself is never sent over IPC and never lands in `settings.json`
   * — `main.ts`'s `webRequest.onBeforeSendHeaders` hook reads it
   * from `agentsTokens` to add `Authorization: Bearer <token>` and
   * `x-electric-service: <tenantId>` headers on outbound requests
   * to this server's URL. The URL includes `/services/<tenantId>` so
   * multiple Cloud agent servers on the same host still match the
   * correct tenant when the Electron request hooks inspect URLs.
   *
   * Throws on auth failure so the caller can surface a sensible
   * error in the UI.
   */
  async prepareConnection(
    serviceId: string
  ): Promise<{ url: string; tenantId: string }> {
    const url = cloudAgentServerUrl(serviceId)
    const cached = this.getAgentsToken(serviceId)
    if (cached) return { url, tenantId: serviceId }

    const token = await this.cloudAuth.getToken()
    if (!token) {
      throw new Error(`Not signed in to Electric Cloud`)
    }
    const agentsToken = await this.fetchAgentsToken(serviceId, token)
    this.agentsTokens.set(serviceId, agentsToken)
    await this.secretStore.set(`${TOKEN_REF_PREFIX}${serviceId}`, agentsToken)
    return { url, tenantId: serviceId }
  }

  private async fetchAgentsToken(
    serviceId: string,
    bearerToken: string
  ): Promise<string> {
    const url = new URL(
      `/api/v1/services/streams/${encodeURIComponent(serviceId)}/getTokenForAgents`,
      getCloudBaseUrl()
    ).toString()
    const res = await fetch(url, {
      method: `POST`,
      headers: {
        'content-type': `application/json`,
        authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      const errorText = await res.text().catch(() => ``)
      const details = errorText.trim()
      throw new Error(
        `Failed to fetch agents token (HTTP ${res.status} ${res.statusText})${
          details ? `: ${details}` : ``
        }`
      )
    }
    const text = await res.text()
    let body: unknown = text
    try {
      body = text.length > 0 ? JSON.parse(text) : null
    } catch {
      // Plain-text token responses are accepted below.
    }
    const agentsToken = extractAgentsToken(body)
    if (!agentsToken) {
      throw new Error(`Agents token response was malformed`)
    }
    return agentsToken
  }

  /** Tear down all shape streams and reset to `idle`. */
  async stop(): Promise<void> {
    for (const key of [
      `agentServers`,
      `environments`,
      `projects`,
      `workspaces`,
    ] as const) {
      const handle = this.streams[key]
      if (!handle) continue
      try {
        handle.unsubscribe()
      } catch {
        // best-effort teardown
      }
      this.streams[key] = null
    }
    this.currentToken = null
    if (this.state.status !== `idle`) {
      this.setState(EMPTY_STATE)
    }
  }

  private openStream(path: string, token: string): StreamHandle {
    const url = new URL(path, getCloudBaseUrl()).toString()
    const rows = new Map<string, Row>()
    const stream = new ShapeStream({
      url,
      // The admin-API expects a JWT bearer; the proxy forwards the
      // request to admin Electric and returns the shape stream body
      // unchanged, so passing the header here is enough.
      fetchClient: (input, init) => {
        const headers = new Headers(init?.headers)
        headers.set(`Authorization`, `Bearer ${token}`)
        return fetch(input, { ...init, headers })
      },
    })
    const unsubscribe = stream.subscribe(
      (messages: Array<Message>) => {
        let mutated = false
        for (const msg of messages) {
          if (`headers` in msg && `key` in msg) {
            const op = msg.headers?.operation
            const key = msg.key as string
            if (op === `delete`) {
              if (rows.delete(key)) mutated = true
            } else {
              rows.set(key, msg.value as Row)
              mutated = true
            }
          }
        }
        if (mutated) this.rebuildState()
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        const status = (err as { status?: number } | null)?.status
        if (status === 401 || status === 403) {
          this.setState({
            status: `unauthorized`,
            servers: this.state.servers,
            error: message,
          })
          // Stop streams — a dead JWT will keep failing.
          void this.stop()
          return
        }
        // Transient — keep previous rows visible, just surface the
        // error so the UI can show a banner.
        this.setState({
          status: `error`,
          servers: this.state.servers,
          error: message,
        })
      }
    )
    return { stream, rows, unsubscribe }
  }

  private rebuildState(): void {
    const agentServerRows = collect<AgentServerRow>(
      this.streams.agentServers?.rows
    )
    const environmentRows = indexBy<EnvironmentRow>(
      collect<EnvironmentRow>(this.streams.environments?.rows),
      (row) => row.id
    )
    const projectRows = indexBy<ProjectRow>(
      collect<ProjectRow>(this.streams.projects?.rows),
      (row) => row.id
    )
    const workspaceRows = indexBy<WorkspaceRow>(
      collect<WorkspaceRow>(this.streams.workspaces?.rows),
      (row) => row.id
    )

    const servers: Array<CloudAgentServer> = agentServerRows.map((row) => {
      const env = environmentRows.get(row.environment_id) ?? null
      const project = env ? (projectRows.get(env.project_id) ?? null) : null
      const workspace = project
        ? (workspaceRows.get(project.workspace_id) ?? null)
        : null
      return {
        id: row.id,
        name: row.name,
        environmentId: env?.id ?? row.environment_id ?? null,
        environmentName: env?.name ?? null,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        workspaceId: workspace?.id ?? null,
        workspaceName: workspace?.name ?? null,
        updatedAt: row.updated_at ?? null,
      }
    })

    servers.sort((a, b) => {
      const wa = (a.workspaceName ?? `￿`).localeCompare(b.workspaceName ?? `￿`)
      if (wa !== 0) return wa
      const pa = (a.projectName ?? `￿`).localeCompare(b.projectName ?? `￿`)
      if (pa !== 0) return pa
      const ea = (a.environmentName ?? `￿`).localeCompare(
        b.environmentName ?? `￿`
      )
      if (ea !== 0) return ea
      return a.name.localeCompare(b.name)
    })

    this.setState({ status: `ready`, servers, error: null })
  }

  private setState(next: CloudAgentServersState): void {
    this.state = next
    for (const listener of this.listeners) {
      try {
        listener(next)
      } catch (err) {
        console.warn(
          `[agents-desktop] cloud-agent-servers listener threw:`,
          err
        )
      }
    }
  }
}

function cloudAgentServerUrl(serviceId: string): string {
  const base = new URL(getCloudAgentsBaseUrl())
  const basePath =
    base.pathname === `/` ? `` : base.pathname.replace(/\/+$/, ``)
  base.pathname = `${basePath}/services/${encodeURIComponent(serviceId)}`
  base.search = ``
  base.hash = ``
  return base.toString()
}

function extractAgentsToken(body: unknown): string | null {
  if (typeof body === `string`) {
    const token = body.trim()
    return token.length > 0 ? token : null
  }
  if (!body || typeof body !== `object`) return null
  const root = body as Record<string, unknown>
  const json = `json` in root ? root.json : root
  if (typeof json === `string`) {
    const token = json.trim()
    return token.length > 0 ? token : null
  }
  if (!json || typeof json !== `object`) return null
  const payload = json as Record<string, unknown>
  for (const key of [
    `token`,
    `principalToken`,
    `principal_token`,
    `bearerToken`,
    `bearer_token`,
    `accessToken`,
    `access_token`,
  ]) {
    const token = payload[key]
    if (typeof token === `string` && token.trim().length > 0) {
      return token.trim()
    }
  }
  return null
}

function isExpiredJwt(token: string, skewMs = 0): boolean {
  const [, payload] = token.split(`.`)
  if (!payload) return false
  try {
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, `=`)
    const decoded = Buffer.from(
      padded.replace(/-/g, `+`).replace(/_/g, `/`),
      `base64`
    ).toString(`utf8`)
    const json = JSON.parse(decoded) as { exp?: unknown }
    if (typeof json.exp !== `number` || !Number.isFinite(json.exp)) {
      return false
    }
    return json.exp * 1000 <= Date.now() + skewMs
  } catch {
    return false
  }
}

function collect<T>(rows: Map<string, Row> | undefined): Array<T> {
  if (!rows) return []
  return Array.from(rows.values()) as Array<T>
}

function indexBy<T>(rows: Array<T>, key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>()
  for (const row of rows) {
    map.set(key(row), row)
  }
  return map
}
