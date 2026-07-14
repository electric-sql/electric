import path from 'node:path'
import os from 'node:os'
import { app, powerSaveBlocker } from 'electron'
import { AGENT_SKILLS_DIR } from '../shared/paths'
import {
  MCP_OAUTH_REDIRECT_BASE,
  PULL_WAKE_OWNER_PRINCIPAL,
  PULL_WAKE_REGISTER_RUNNER,
  PULL_WAKE_RUNNER_ID,
  PULL_WAKE_RUNNER_LABEL,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
} from '../shared/constants'
import {
  hasHeader,
  mergeHeaders,
  runnerOwnerPrincipalFromHeaders,
  runnerOwnerPrincipalFromUserId,
} from '../shared/headers'
import type { CloudAgentServers } from '../cloud/cloud-agent-servers'
import type { CloudAuthState } from '../cloud/cloud-auth'
import { resolveEnabledModelValues } from '../credentials/model-picker'
import { checkAgentsServerHealth, formatStartupNetworkError } from './health'
import type {
  ConnectServerOptions,
  DesktopState,
  McpServerConfig,
  RegistrySnapshot,
  RuntimeEntry,
  ServerConfig,
  LocalRuntimeStatus,
} from '../shared/types'

export type RuntimeLifecycleDeps = {
  settings: {
    servers: Array<ServerConfig>
    defaultServerId: string | null
    workingDirectory?: string | null
    mcp?: { servers: Array<McpServerConfig> }
    pullWakeRunnerId?: string | null
    pullWakeRunnerLabel?: string
    preventAppSuspension?: boolean
    enabledModelValues?: Array<string>
    skillDirectories?: Array<string>
  }
  runtimeEntries: Map<string, RuntimeEntry>
  windowSelections: Map<number, string | null>
  findServer: (serverId: string | null | undefined) => ServerConfig | null
  ensureRuntimeEntry: (server: ServerConfig) => RuntimeEntry
  saveSettings: () => Promise<void>
  refreshDesktopState: () => void
  setState: (patch: Partial<DesktopState>) => void
  setCredentialsRestartPending: (value: boolean) => void
  injectDevPrincipalHeaders: (server: ServerConfig) => ServerConfig
  configureRuntimeEnvironment: () => void
  applyApiKeys: () => void
  syncCodexEnvironment: () => Promise<void>
  broadcastMcpSnapshot: (serverId: string, snapshot: RegistrySnapshot) => void
  handleAuthorizeUrl: (
    serverId: string,
    url: string,
    server: string
  ) => Promise<void>
  getCloudAgentServers: () => CloudAgentServers
  getCloudAuthState: () => CloudAuthState | undefined
}

let powerSaveBlockerId: number | null = null

function reconnectDelayMs(attempt: number): number {
  const base = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * Math.max(1, 2 ** Math.min(attempt, 5))
  )
  return Math.round(base * (0.8 + Math.random() * 0.4))
}

export function hasConnectedLocalRuntime(deps: RuntimeLifecycleDeps): boolean {
  return deps.settings.servers.some(
    (server) =>
      server.localRuntimeEnabled && server.desiredState === `connected`
  )
}

function shouldPreventAppSuspension(deps: RuntimeLifecycleDeps): boolean {
  if (deps.settings.preventAppSuspension === false) return false
  return [...deps.runtimeEntries.values()].some(
    (entry) =>
      entry.desiredState === `connected` &&
      ([`starting`, `running`] as Array<LocalRuntimeStatus>).includes(
        entry.localRuntimeStatus
      )
  )
}

export function refreshPowerSaveBlocker(deps: RuntimeLifecycleDeps): void {
  const shouldBlock = shouldPreventAppSuspension(deps)
  if (shouldBlock) {
    if (
      powerSaveBlockerId === null ||
      !powerSaveBlocker.isStarted(powerSaveBlockerId)
    ) {
      powerSaveBlockerId = powerSaveBlocker.start(`prevent-app-suspension`)
      console.info(
        `[agents-desktop] Enabled power save blocker to keep the desktop runtime available while connected.`
      )
    }
    return
  }

  if (
    powerSaveBlockerId !== null &&
    powerSaveBlocker.isStarted(powerSaveBlockerId)
  ) {
    powerSaveBlocker.stop(powerSaveBlockerId)
    console.info(`[agents-desktop] Disabled power save blocker.`)
  }
  powerSaveBlockerId = null
}

export async function restartConnectedRuntimes(
  deps: RuntimeLifecycleDeps
): Promise<void> {
  await Promise.all(
    deps.settings.servers
      .filter((server) => server.desiredState === `connected`)
      .map((server) => restartRuntime(deps, server.id))
  )
  deps.setCredentialsRestartPending(false)
}

export async function stopExistingRuntime(
  deps: RuntimeLifecycleDeps
): Promise<void> {
  await Promise.all(
    [...deps.runtimeEntries.values()].map(async (entry) => {
      await stopRuntimeEntry(deps, entry)
      entry.status =
        entry.desiredState === `connected` ? `offline` : `disconnected`
    })
  )
}

export function scheduleReconnect(
  deps: RuntimeLifecycleDeps,
  serverId: string
): void {
  const server = deps.findServer(serverId)
  const entry = server ? deps.ensureRuntimeEntry(server) : null
  if (!server || !entry || entry.desiredState !== `connected`) return
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
  const delay = reconnectDelayMs(entry.reconnectAttempt)
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null
    void startRuntime(deps, serverId)
  }, delay)
  deps.refreshDesktopState()
}

export async function stopRuntimeEntry(
  deps: RuntimeLifecycleDeps,
  entry: RuntimeEntry
): Promise<void> {
  entry.generation += 1
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
  }
  if (entry.mcpUnsubscribe) {
    entry.mcpUnsubscribe()
    entry.mcpUnsubscribe = null
  }
  deps.broadcastMcpSnapshot(entry.serverId, { seq: 0, servers: [] })
  const current = entry.runtime
  entry.runtime = null
  entry.runtimeUrl = null
  entry.runtimeError = null
  entry.localRuntimeStatus = deps.findServer(entry.serverId)
    ?.localRuntimeEnabled
    ? `stopped`
    : `disabled`
  refreshPowerSaveBlocker(deps)
  if (current) {
    await current.stop()
  }
}

async function startRuntimeAttempt(
  deps: RuntimeLifecycleDeps,
  serverId: string
): Promise<void> {
  const activeServer = deps.findServer(serverId)
  if (!activeServer) return
  const entry = deps.ensureRuntimeEntry(activeServer)
  if (entry.desiredState !== `connected`) return

  await stopRuntimeEntry(deps, entry)
  if (entry.desiredState !== `connected`) return
  const generation = ++entry.generation

  entry.status = entry.reconnectAttempt > 0 ? `reconnecting` : `connecting`
  entry.lastError = null
  deps.refreshDesktopState()

  if (activeServer.source === `electric-cloud`) {
    if (!activeServer.tenantId) {
      entry.status = `error`
      entry.lastError = `Cloud server ${activeServer.name} is missing a tenant id.`
      deps.refreshDesktopState()
      return
    }

    const cloudAuthState = deps.getCloudAuthState()
    if (cloudAuthState?.status !== `signed-in`) {
      entry.status = `error`
      entry.lastError = `Sign in to Electric Cloud before connecting to ${activeServer.name}.`
      deps.refreshDesktopState()
      return
    }

    try {
      const prepared = await deps
        .getCloudAgentServers()
        .prepareConnection(activeServer.tenantId)
      if (prepared.url !== activeServer.url) {
        activeServer.url = prepared.url
        await deps.saveSettings()
      }
    } catch (err) {
      entry.status = `error`
      entry.lastError = `Could not prepare cloud agents token for ${activeServer.name}: ${
        err instanceof Error ? err.message : String(err)
      }`
      deps.refreshDesktopState()
      return
    }
  }

  const serverHealth = await checkAgentsServerHealth(activeServer.url, 4_000)
  if (!serverHealth.ok) {
    entry.status = `offline`
    entry.lastError = `Could not reach agents-server at ${activeServer.url}: ${serverHealth.reason}.`
    entry.reconnectAttempt += 1
    scheduleReconnect(deps, serverId)
    return
  }

  if (!activeServer.localRuntimeEnabled) {
    entry.status = `connected`
    entry.localRuntimeStatus = `disabled`
    entry.runtimeUrl = null
    entry.runtimeError = null
    entry.lastError = null
    entry.reconnectAttempt = 0
    entry.lastConnectedAt = Date.now()
    refreshPowerSaveBlocker(deps)
    deps.refreshDesktopState()
    return
  }

  const runnerId = PULL_WAKE_RUNNER_ID ?? deps.settings.pullWakeRunnerId
  if (!runnerId) {
    throw new Error(`Desktop built-in agents require a pull-wake runner id`)
  }
  if (!deps.settings.pullWakeRunnerId) {
    deps.settings.pullWakeRunnerId = runnerId
    await deps.saveSettings()
  }
  deps.setState({ pullWakeRunnerId: runnerId })

  const serverWithPrincipal = deps.injectDevPrincipalHeaders(activeServer)
  const runtimeHeaders = mergeHeaders(serverWithPrincipal.headers)
  const cloudAuthState =
    activeServer.source === `electric-cloud` ? deps.getCloudAuthState() : null
  const runnerOwnerPrincipal =
    runnerOwnerPrincipalFromUserId(cloudAuthState?.userId ?? null) ??
    runnerOwnerPrincipalFromHeaders(runtimeHeaders, PULL_WAKE_OWNER_PRINCIPAL)
  const runnerLabelPrefix =
    cloudAuthState?.name?.trim() ||
    cloudAuthState?.email?.trim() ||
    `Electric Desktop`
  console.info(
    `[agents-desktop] Starting built-in agents runtime for server ${activeServer.url}`
  )
  console.info(`[agents-desktop] Pull-wake runner id: ${runnerId}`)
  if (PULL_WAKE_REGISTER_RUNNER) {
    console.info(
      `[agents-desktop] Pull-wake runner registration enabled; owner principal: ${runnerOwnerPrincipal ?? `(derived from auth)`}`
    )
  } else {
    console.info(
      `[agents-desktop] Pull-wake runner registration skipped; runner must already be registered with the agents server.`
    )
  }

  deps.configureRuntimeEnvironment()
  deps.applyApiKeys()
  await deps.syncCodexEnvironment()
  const { BuiltinAgentsServer } = await import(`@electric-ax/agents`)
  const nextRuntime = new BuiltinAgentsServer({
    agentServerUrl: activeServer.url,
    workingDirectory: deps.settings.workingDirectory ?? app.getPath(`home`),
    durableStreamsFetchCache: {
      store: `sqlite`,
      sqliteLocation: path.join(
        app.getPath(`userData`),
        `durable-streams-fetch-cache.sqlite`
      ),
      maxCount: 10_000,
    },
    extraMcpServers: deps.settings.mcp?.servers,
    enabledModelValues: resolveEnabledModelValues(
      deps.settings.enabledModelValues
    ),
    loadProjectMcpConfig: true,
    mcpOAuthRedirectBase: MCP_OAUTH_REDIRECT_BASE,
    baseSkillsDir: AGENT_SKILLS_DIR,
    appSkillsDirs: desktopSkillDirectories({
      workingDirectory: deps.settings.workingDirectory ?? app.getPath(`home`),
      configured: deps.settings.skillDirectories ?? [],
    }),
    openAuthorizeUrl: (url, server) => {
      void deps.handleAuthorizeUrl(serverId, url, server)
    },
    pullWake: {
      runnerId,
      registerRunner: PULL_WAKE_REGISTER_RUNNER,
      ownerPrincipal: PULL_WAKE_REGISTER_RUNNER
        ? runnerOwnerPrincipal
        : undefined,
      label:
        PULL_WAKE_RUNNER_LABEL ??
        deps.settings.pullWakeRunnerLabel ??
        `${runnerLabelPrefix} · ${os.hostname()}`,
      headers: runtimeHeaders,
      claimHeaders: runtimeHeaders,
      claimTokenHeader:
        activeServer.source === `electric-cloud` ||
        hasHeader(runtimeHeaders, `authorization`)
          ? `electric-claim-token`
          : undefined,
    },
  })
  entry.runtime = nextRuntime
  entry.localRuntimeStatus = `starting`
  entry.runtimeError = null
  refreshPowerSaveBlocker(deps)
  deps.refreshDesktopState()

  try {
    const runtimeUrl = await nextRuntime.start()
    if (generation !== entry.generation) {
      await nextRuntime.stop()
      return
    }
    entry.status = `connected`
    entry.localRuntimeStatus = `running`
    entry.runtimeUrl = runtimeUrl
    entry.runtimeError = null
    entry.lastError = null
    entry.reconnectAttempt = 0
    entry.lastConnectedAt = Date.now()
    refreshPowerSaveBlocker(deps)
    deps.refreshDesktopState()
    const reg = nextRuntime.mcpRegistry
    if (reg) {
      entry.mcpUnsubscribe = reg.subscribe((snapshot: RegistrySnapshot) => {
        deps.broadcastMcpSnapshot(serverId, snapshot)
      })
    }
  } catch (error) {
    if (entry.runtime === nextRuntime) {
      entry.runtime = null
    }
    const startupNetworkError = formatStartupNetworkError(
      error,
      activeServer.url
    )
    entry.status = `error`
    entry.localRuntimeStatus = `error`
    entry.runtimeUrl = null
    entry.runtimeError =
      startupNetworkError ??
      (error instanceof Error ? error.message : String(error))
    entry.lastError =
      startupNetworkError ??
      (error instanceof Error ? error.message : String(error))
    entry.reconnectAttempt += 1
    refreshPowerSaveBlocker(deps)
    scheduleReconnect(deps, serverId)
  }
}

export async function startRuntime(
  deps: RuntimeLifecycleDeps,
  serverId: string
): Promise<void> {
  try {
    await startRuntimeAttempt(deps, serverId)
  } catch (error) {
    const activeServer = deps.findServer(serverId)
    if (!activeServer) return
    const entry = deps.ensureRuntimeEntry(activeServer)
    if (entry.desiredState !== `connected`) return

    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[agents-desktop] Failed to start built-in agents runtime for ${activeServer.url}:`,
      error
    )
    entry.status = `error`
    entry.localRuntimeStatus = `error`
    entry.runtimeUrl = null
    entry.runtimeError = message
    entry.lastError = message
    entry.reconnectAttempt += 1
    refreshPowerSaveBlocker(deps)
    deps.refreshDesktopState()
    scheduleReconnect(deps, serverId)
  }
}

export async function connectServer(
  deps: RuntimeLifecycleDeps,
  serverId: string,
  options: ConnectServerOptions = {}
): Promise<void> {
  const server = deps.findServer(serverId)
  if (!server) return
  if (typeof options.localRuntimeEnabled === `boolean`) {
    server.localRuntimeEnabled = options.localRuntimeEnabled
  }
  server.desiredState = `connected`
  const entry = deps.ensureRuntimeEntry(server)
  entry.desiredState = `connected`
  entry.reconnectAttempt = 0
  await deps.saveSettings()
  await startRuntime(deps, serverId)
}

export async function disconnectServer(
  deps: RuntimeLifecycleDeps,
  serverId: string
): Promise<void> {
  const server = deps.findServer(serverId)
  if (!server) return
  server.desiredState = `disconnected`
  const entry = deps.ensureRuntimeEntry(server)
  entry.desiredState = `disconnected`
  await stopRuntimeEntry(deps, entry)
  entry.status = `disconnected`
  entry.lastError = null
  entry.reconnectAttempt = 0
  await deps.saveSettings()
  deps.refreshDesktopState()
}

export async function forgetServer(
  deps: RuntimeLifecycleDeps,
  serverId: string
): Promise<void> {
  const server = deps.findServer(serverId)
  if (!server) return
  await disconnectServer(deps, serverId)
  deps.settings.servers = deps.settings.servers.filter(
    (entry) => entry.id !== serverId
  )
  deps.runtimeEntries.delete(serverId)
  if (server.tenantId) {
    await deps.getCloudAgentServers().forgetAgentsToken(server.tenantId)
  }
  if (deps.settings.defaultServerId === serverId) {
    deps.settings.defaultServerId = deps.settings.servers[0]?.id ?? null
  }
  for (const [windowId, selectedServerId] of deps.windowSelections) {
    if (selectedServerId === serverId) {
      deps.windowSelections.set(windowId, deps.settings.defaultServerId)
    }
  }
  await deps.saveSettings()
  deps.refreshDesktopState()
}

export async function restartRuntime(
  deps: RuntimeLifecycleDeps,
  serverId?: string | null
): Promise<void> {
  const id = serverId ?? deps.settings.defaultServerId
  if (!id) return
  const server = deps.findServer(id)
  if (!server) return
  server.desiredState = `connected`
  const entry = deps.ensureRuntimeEntry(server)
  entry.desiredState = `connected`
  entry.reconnectAttempt = 0
  await deps.saveSettings()
  await startRuntime(deps, id)
  if (server.localRuntimeEnabled) deps.setCredentialsRestartPending(false)
}

export async function stopRuntime(
  deps: RuntimeLifecycleDeps,
  serverId?: string | null
): Promise<void> {
  const id = serverId ?? deps.settings.defaultServerId
  if (!id) return
  await disconnectServer(deps, id)
}

export function desktopSkillDirectories(opts: {
  workingDirectory: string
  configured: ReadonlyArray<string>
}): Array<string> {
  const home = app.getPath(`home`)
  return dedupePaths([
    path.join(home, `.claude`, `skills`),
    path.join(home, `.claude`, `commands`),
    path.join(home, `.codex`, `skills`),
    path.join(opts.workingDirectory, `.claude`, `skills`),
    path.join(opts.workingDirectory, `.claude`, `commands`),
    path.join(opts.workingDirectory, `.codex`, `skills`),
    ...opts.configured.map((dir) => expandHome(dir, home)),
  ])
}

function expandHome(dir: string, home: string): string {
  if (dir === `~`) return home
  if (dir.startsWith(`~/`)) return path.join(home, dir.slice(2))
  return dir
}

function dedupePaths(paths: ReadonlyArray<string>): Array<string> {
  const seen = new Set<string>()
  const result: Array<string> = []
  for (const entry of paths) {
    const resolved = path.resolve(entry)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    result.push(resolved)
  }
  return result
}
