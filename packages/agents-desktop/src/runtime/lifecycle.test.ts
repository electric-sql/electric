import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEntry, ServerConfig } from '../shared/types'
import type { RuntimeLifecycleDeps } from './lifecycle'

vi.mock(`@electric-ax/agents`, () => ({
  BuiltinAgentsServer: vi.fn(),
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
  const actual = await importOriginal<typeof import(`./health`)>()
  return {
    ...actual,
    checkAgentsServerHealth: vi.fn(async () => ({ ok: true })),
  }
})

import { startRuntime } from './lifecycle'

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
    findServer: (serverId) => (serverId === server.id ? server : null),
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
