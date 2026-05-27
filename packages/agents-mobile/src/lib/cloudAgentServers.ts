import { useEffect, useMemo, useState } from 'react'
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { useLiveQuery } from '@tanstack/react-db'
import { z } from 'zod'
import { cloudAuth, debugCloudAuth, getCloudBaseUrl } from './cloudAuth'
import type { CloudAuthState } from './cloudAuth'

/**
 * Continuously-synced, denormalized view of the Cloud agent servers the
 * signed-in user can see.
 *
 * Mirrors `packages/agents-desktop/src/cloud-agent-servers.ts` — it
 * subscribes to four admin-API shapes (`agent-servers`, `environments`,
 * `projects`, `workspaces`) and joins them so each row carries the full
 * Workspace › Project › Environment › Server breadcrumb the picker UI
 * needs.
 *
 * Differences from desktop:
 *   - No IPC layer; consumed via a React hook (`useCloudAgentServers`).
 *   - No `SecretStore` for per-service tokens — `cloudAuth.getAgentsToken`
 *     already handles in-memory caching, and `serverHeaders.prepareServerHeaders`
 *     plumbs the token in on every outbound request via `serverFetch`.
 *   - The shape collections' `fetchClient` reads the user's dashboard
 *     bearer from `cloudAuth.getToken()` on every request, so a token
 *     refresh (or sign-out) just propagates the next time Electric
 *     polls — no need to tear down and recreate the collections.
 */

export type CloudAgentServerStatus =
  | `idle`
  | `loading`
  | `ready`
  | `unauthorized`
  | `error`

export type CloudAgentServer = {
  /** `stream_services.id` — also the tenant identifier in the agents URL's `?service=`. */
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

export type CloudAgentServersResult = {
  status: CloudAgentServerStatus
  servers: ReadonlyArray<CloudAgentServer>
  error: string | null
}

const agentServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  environment_id: z.string(),
  type: z.string().optional(),
  variant: z.string().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
})

const environmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  project_id: z.string(),
  deleted_at: z.string().nullable().optional(),
})

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspace_id: z.string(),
  deleted_at: z.string().nullable().optional(),
})

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  deleted_at: z.string().nullable().optional(),
})

const SHAPE_PATHS = {
  agentServers: `/api/internal/v1/agent-servers`,
  environments: `/api/internal/v1/environments`,
  projects: `/api/internal/v1/projects`,
  workspaces: `/api/internal/v1/workspaces`,
} as const

function shapePathLabel(input: RequestInfo | URL): string {
  const raw =
    typeof input === `string`
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
  try {
    const url = new URL(raw)
    return `${url.pathname}${url.search}`
  } catch {
    return raw
  }
}

/**
 * Inject the user's Cloud bearer token on every shape request. Resolves
 * the token from `cloudAuth.getToken()` on each call so token rotation
 * / sign-out propagates without us having to recreate the collections.
 */
async function cloudFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const token = await cloudAuth.getToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set(`Authorization`, `Bearer ${token}`)
  const label = shapePathLabel(input)
  debugCloudAuth(`cloudAgentServers:fetch:start`, {
    label,
    hasToken: !!token,
    method: init?.method ?? `GET`,
  })
  let response: Response
  try {
    response = await fetch(input, { ...init, headers })
  } catch (error) {
    debugCloudAuth(`cloudAgentServers:fetch:error`, {
      label,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
  debugCloudAuth(`cloudAgentServers:fetch:response`, {
    label,
    status: response.status,
    ok: response.ok,
  })
  return response
}

function createAgentServersCollection(dashboardUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `cloud-agent-servers:${dashboardUrl}`,
      schema: agentServerSchema,
      shapeOptions: {
        url: new URL(SHAPE_PATHS.agentServers, dashboardUrl).toString(),
        fetchClient: cloudFetch,
      },
      getKey: (item) => item.id,
    })
  )
}

function createEnvironmentsCollection(dashboardUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `cloud-environments:${dashboardUrl}`,
      schema: environmentSchema,
      shapeOptions: {
        url: new URL(SHAPE_PATHS.environments, dashboardUrl).toString(),
        fetchClient: cloudFetch,
      },
      getKey: (item) => item.id,
    })
  )
}

function createProjectsCollection(dashboardUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `cloud-projects:${dashboardUrl}`,
      schema: projectSchema,
      shapeOptions: {
        url: new URL(SHAPE_PATHS.projects, dashboardUrl).toString(),
        fetchClient: cloudFetch,
      },
      getKey: (item) => item.id,
    })
  )
}

function createWorkspacesCollection(dashboardUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `cloud-workspaces:${dashboardUrl}`,
      schema: workspaceSchema,
      shapeOptions: {
        url: new URL(SHAPE_PATHS.workspaces, dashboardUrl).toString(),
        fetchClient: cloudFetch,
      },
      getKey: (item) => item.id,
    })
  )
}

type CollectionSet = {
  agentServers: ReturnType<typeof createAgentServersCollection>
  environments: ReturnType<typeof createEnvironmentsCollection>
  projects: ReturnType<typeof createProjectsCollection>
  workspaces: ReturnType<typeof createWorkspacesCollection>
}

// Module-level cache so multiple components share a single set of
// shape subscriptions per dashboard URL.
const collectionsByDashboard = new Map<string, CollectionSet>()

function getOrCreateCollections(dashboardUrl: string): CollectionSet {
  const existing = collectionsByDashboard.get(dashboardUrl)
  if (existing) return existing
  const set: CollectionSet = {
    agentServers: createAgentServersCollection(dashboardUrl),
    environments: createEnvironmentsCollection(dashboardUrl),
    projects: createProjectsCollection(dashboardUrl),
    workspaces: createWorkspacesCollection(dashboardUrl),
  }
  collectionsByDashboard.set(dashboardUrl, set)
  return set
}

/**
 * Resolve the Cloud agents server base URL for a service id. Same shape
 * the desktop produces — host swap `dashboard` → `agents`, service id
 * carried in the `?service=` query param so multiple Cloud servers on
 * the same host stay routable.
 */
export function cloudAgentServerUrl(serviceId: string): string {
  const dashboardUrl = new URL(getCloudBaseUrl())
  const agentsUrl = new URL(dashboardUrl.toString())
  if (/^dashboard([.-]|$)/.test(dashboardUrl.hostname)) {
    agentsUrl.hostname = dashboardUrl.hostname.replace(
      /^dashboard(?=[.-]|$)/,
      `agents`
    )
  }
  agentsUrl.pathname = `/`
  agentsUrl.search = ``
  agentsUrl.hash = ``
  agentsUrl.searchParams.set(`service`, serviceId)
  return agentsUrl.toString()
}

/**
 * Reactively project the four shapes into a sorted, denormalized list
 * of Cloud agent servers the signed-in user can see. Returns an empty
 * list when signed out (no subscriptions are opened in that case).
 */
export function useCloudAgentServers(): CloudAgentServersResult {
  const [authStatus, setAuthStatus] = useState<CloudAuthState[`status`]>(
    () => cloudAuth.getState().status
  )
  const [sawUnauthorized, setSawUnauthorized] = useState(false)
  useEffect(() => {
    setAuthStatus(cloudAuth.getState().status)
    return cloudAuth.subscribe((s) => setAuthStatus(s.status))
  }, [])

  useEffect(() => {
    if (authStatus !== `signed-in`) {
      setSawUnauthorized(false)
      return
    }
    void cloudAuth.getToken().then((token) => {
      debugCloudAuth(`cloudAgentServers:authToken`, {
        authStatus,
        hasToken: !!token,
      })
      if (!token) setSawUnauthorized(true)
    })
  }, [authStatus])

  const collections = useMemo(() => {
    if (authStatus !== `signed-in`) return null
    return getOrCreateCollections(getCloudBaseUrl())
  }, [authStatus])

  const { data: agentServerRows = [], status: agentServersStatus } =
    useLiveQuery(
      (query) => {
        if (!collections) return undefined
        return query.from({ s: collections.agentServers })
      },
      [collections]
    )
  const { data: environmentRows = [] } = useLiveQuery(
    (query) => {
      if (!collections) return undefined
      return query.from({ e: collections.environments })
    },
    [collections]
  )
  const { data: projectRows = [] } = useLiveQuery(
    (query) => {
      if (!collections) return undefined
      return query.from({ p: collections.projects })
    },
    [collections]
  )
  const { data: workspaceRows = [] } = useLiveQuery(
    (query) => {
      if (!collections) return undefined
      return query.from({ w: collections.workspaces })
    },
    [collections]
  )

  useEffect(() => {
    debugCloudAuth(`cloudAgentServers:hookState`, {
      authStatus,
      hasCollections: !!collections,
      agentServersStatus,
      counts: {
        agentServers: agentServerRows.length,
        environments: environmentRows.length,
        projects: projectRows.length,
        workspaces: workspaceRows.length,
      },
    })
  }, [
    authStatus,
    collections,
    agentServersStatus,
    agentServerRows.length,
    environmentRows.length,
    projectRows.length,
    workspaceRows.length,
  ])

  return useMemo<CloudAgentServersResult>(() => {
    if (!collections) {
      return { status: `idle`, servers: [], error: null }
    }
    if (sawUnauthorized) {
      return {
        status: `unauthorized`,
        servers: [],
        error: `Cloud session unavailable for server discovery.`,
      }
    }
    const environments = new Map(environmentRows.map((r) => [r.id, r]))
    const projects = new Map(projectRows.map((r) => [r.id, r]))
    const workspaces = new Map(workspaceRows.map((r) => [r.id, r]))
    const servers: Array<CloudAgentServer> = agentServerRows
      .filter((row) => !row.deleted_at)
      .map((row) => {
        const env = environments.get(row.environment_id) ?? null
        const project = env ? (projects.get(env.project_id) ?? null) : null
        const workspace = project
          ? (workspaces.get(project.workspace_id) ?? null)
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
    debugCloudAuth(`cloudAgentServers:joinedServers`, {
      status: agentServersStatus,
      serverIds: servers.map((server) => server.id),
      serverNames: servers.map((server) => server.name),
    })
    const status: CloudAgentServerStatus =
      agentServersStatus === `loading` ? `loading` : `ready`
    return { status, servers, error: null }
  }, [
    collections,
    agentServerRows,
    environmentRows,
    projectRows,
    workspaceRows,
    agentServersStatus,
    sawUnauthorized,
  ])
}
