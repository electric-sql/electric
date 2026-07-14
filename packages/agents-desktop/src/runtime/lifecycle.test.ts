import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEntry, ServerConfig } from '../shared/types'
import type { RuntimeLifecycleDeps } from './lifecycle'

vi.mock(`@electric-ax/agents`, () => ({
  BuiltinAgentsServer: vi.fn(() => ({
    reconnectPullWake: vi.fn(),
  })),
}))

vi.mock(`electron`, () => ({
  app: { getPath: () => `/tmp` },
  powerSaveBlocker: {
    isStarted: () => false,
    start: () => 1,
    stop: vi.fn(),
  },
}))

vi.mock(`./health`, async (importOriginal) => {
  // prettier-ignore
  const actual = await importOriginal<typeof import(`./health`)>()
  return {
    ...actual,
    checkAgentsServerHealth: vi.fn(async () => ({ ok: true })),
  }
})

import { reconnectPullWakesAfterResume, startRuntime } from './lifecycle'

type AddedRuntimeOptions = {
  id: string
  desiredState: ServerConfig[`desiredState`]
  localRuntimeEnabled: boolean
  localRuntimeStatus: RuntimeEntry[`localRuntimeStatus`]
}

function addRuntime(
  deps: RuntimeLifecycleDeps,
  options: AddedRuntimeOptions
): {
  reconnect: ReturnType<typeof vi.fn>
  server: ServerConfig
  entry: RuntimeEntry
} {
  const reconnect = vi.fn()
  const server: ServerConfig = {
    id: options.id,
    name: options.id,
    url: `http://localhost/${options.id}`,
    source: `manual`,
    desiredState: options.desiredState,
    localRuntimeEnabled: options.localRuntimeEnabled,
  }
  const entry: RuntimeEntry = {
    serverId: server.id,
    desiredState: options.desiredState,
    status: options.desiredState === `connected` ? `connected` : `disconnected`,
    localRuntimeStatus: options.localRuntimeStatus,
    runtime: {
      reconnectPullWake: reconnect,
    } as unknown as RuntimeEntry[`runtime`],
    runtimeUrl: null,
    runtimeError: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    generation: 0,
    lastError: null,
    lastConnectedAt: null,
    mcpUnsubscribe: null,
  }
  deps.settings.servers.push(server)
  deps.runtimeEntries.set(server.id, entry)
  return { reconnect, server, entry }
}

function setup(): {
  deps: RuntimeLifecycleDeps
  entry: RuntimeEntry
} {
  const server: ServerConfig = {
    id: `local`,
    name: `Local`,
    url: `http://localhost:4437`,
    source: `manual`,
    desiredState: `connected`,
    localRuntimeEnabled: true,
  }
  const entry: RuntimeEntry = {
    serverId: server.id,
    desiredState: `connected`,
    status: `disconnected`,
    localRuntimeStatus: `stopped`,
    runtime: null,
    runtimeUrl: null,
    runtimeError: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    generation: 0,
    lastError: null,
    lastConnectedAt: null,
    mcpUnsubscribe: null,
  }
  const deps: RuntimeLifecycleDeps = {
    settings: {
      servers: [server],
      defaultServerId: server.id,
      pullWakeRunnerId: null,
    },
    runtimeEntries: new Map([[server.id, entry]]),
    windowSelections: new Map(),
    findServer: (serverId) =>
      deps.settings.servers.find((candidate) => candidate.id === serverId) ??
      null,
    ensureRuntimeEntry: () => entry,
    saveSettings: vi.fn(async () => undefined),
    refreshDesktopState: vi.fn(),
    setState: vi.fn(),
    setCredentialsRestartPending: vi.fn(),
    injectDevPrincipalHeaders: (value) => value,
    configureRuntimeEnvironment: vi.fn(),
    applyApiKeys: vi.fn(),
    syncCodexEnvironment: vi.fn(async () => undefined),
    broadcastMcpSnapshot: vi.fn(),
    handleAuthorizeUrl: vi.fn(async () => undefined),
    getCloudAgentServers: vi.fn(),
    getCloudAuthState: vi.fn(),
  }
  return { deps, entry }
}

describe(`desktop runtime lifecycle`, () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it(`reconnects only connected running local runtimes after resume`, () => {
    const { deps, entry } = setup()
    const reconnectRunning = vi.fn()
    entry.status = `connected`
    entry.localRuntimeStatus = `running`
    entry.runtime = {
      reconnectPullWake: reconnectRunning,
    } as unknown as RuntimeEntry[`runtime`]

    const disconnected = addRuntime(deps, {
      id: `disconnected`,
      desiredState: `disconnected`,
      localRuntimeEnabled: true,
      localRuntimeStatus: `running`,
    })
    const disabled = addRuntime(deps, {
      id: `disabled`,
      desiredState: `connected`,
      localRuntimeEnabled: false,
      localRuntimeStatus: `disabled`,
    })
    const starting = addRuntime(deps, {
      id: `starting`,
      desiredState: `connected`,
      localRuntimeEnabled: true,
      localRuntimeStatus: `starting`,
    })

    reconnectPullWakesAfterResume(deps)

    expect(reconnectRunning).toHaveBeenCalledTimes(1)
    expect(disconnected.reconnect).not.toHaveBeenCalled()
    expect(disabled.reconnect).not.toHaveBeenCalled()
    expect(starting.reconnect).not.toHaveBeenCalled()
  })

  it(`isolates pull-wake reconnect failures between runtimes`, () => {
    const { deps, entry } = setup()
    entry.status = `connected`
    entry.localRuntimeStatus = `running`
    entry.runtime = {
      reconnectPullWake: vi.fn(() => {
        throw new Error(`first failed`)
      }),
    } as unknown as RuntimeEntry[`runtime`]
    const second = addRuntime(deps, {
      id: `second`,
      desiredState: `connected`,
      localRuntimeEnabled: true,
      localRuntimeStatus: `running`,
    })

    expect(() => reconnectPullWakesAfterResume(deps)).not.toThrow()
    expect(second.reconnect).toHaveBeenCalledTimes(1)
  })

  it(`records and retries failures that happen before the built-in runtime starts`, async () => {
    const { deps, entry } = setup()

    await expect(startRuntime(deps, `local`)).resolves.toBeUndefined()

    expect(entry.status).toBe(`error`)
    expect(entry.localRuntimeStatus).toBe(`error`)
    expect(entry.lastError).toBe(
      `Desktop built-in agents require a pull-wake runner id`
    )
    expect(entry.reconnectAttempt).toBe(1)
    expect(entry.reconnectTimer).not.toBeNull()
  })
})
