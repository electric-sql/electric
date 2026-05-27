import {
  DISCOVERY_INTERVAL_MS,
  DISCOVERY_PORTS,
  DISCOVERY_TIMEOUT_MS,
  localDiscoveryUrl,
} from '../shared/constants'
import { checkAgentsServerHealth } from '../runtime/health'
import type {
  DesktopState,
  DiscoveredServer,
  RuntimeEntry,
} from '../shared/types'

export type LocalDiscoveryDeps = {
  runtimeEntries: Map<string, RuntimeEntry>
  state: DesktopState
  setState: (patch: Partial<DesktopState>) => void
}

export type LocalDiscoveryLoop = {
  runDiscovery: () => Promise<void>
  startDiscoveryLoop: () => void
  stopDiscoveryLoop: () => void
}

async function probeAgentsServer(url: string): Promise<boolean> {
  const result = await checkAgentsServerHealth(url, DISCOVERY_TIMEOUT_MS)
  return result.ok
}

export function createLocalDiscoveryLoop(
  deps: LocalDiscoveryDeps
): LocalDiscoveryLoop {
  let discoveryTimer: NodeJS.Timeout | null = null
  let discoveryInFlight: Promise<void> | null = null

  const runDiscovery = async (): Promise<void> => {
    if (discoveryInFlight) {
      await discoveryInFlight
      return
    }
    discoveryInFlight = (async () => {
      const skipPorts = new Set(
        [...deps.runtimeEntries.values()]
          .map((entry) => {
            try {
              return entry.runtimeUrl ? new URL(entry.runtimeUrl).port : null
            } catch {
              return null
            }
          })
          .filter((port): port is string => Boolean(port))
      )
      const results = await Promise.all(
        DISCOVERY_PORTS.map(async (port) => {
          if (skipPorts.has(String(port))) return null
          const url = localDiscoveryUrl(port)
          const ok = await probeAgentsServer(url)
          return ok ? { url, port, lastSeen: Date.now() } : null
        })
      )
      const found = results.filter(
        (entry): entry is DiscoveredServer => entry !== null
      )
      found.sort((a, b) => a.port - b.port)

      const prev = deps.state.discoveredServers
      const same =
        prev.length === found.length &&
        prev.every((entry, i) => entry.url === found[i]?.url)
      if (same) return
      deps.setState({ discoveredServers: found })
    })()
    try {
      await discoveryInFlight
    } finally {
      discoveryInFlight = null
    }
  }

  return {
    runDiscovery,
    startDiscoveryLoop() {
      if (discoveryTimer) return
      void runDiscovery()
      discoveryTimer = setInterval(() => {
        void runDiscovery()
      }, DISCOVERY_INTERVAL_MS)
    },
    stopDiscoveryLoop() {
      if (discoveryTimer) {
        clearInterval(discoveryTimer)
        discoveryTimer = null
      }
    },
  }
}
