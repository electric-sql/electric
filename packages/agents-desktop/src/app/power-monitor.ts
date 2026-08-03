import { powerMonitor } from 'electron'

export type PowerMonitorLike = {
  on: (event: `suspend` | `resume`, listener: () => void) => unknown
  removeListener: (event: `suspend` | `resume`, listener: () => void) => unknown
}

export type PowerMonitorRecovery = {
  start: () => void
  stop: () => void
}

export function createPowerMonitorRecovery(options: {
  monitor?: PowerMonitorLike
  onResume: () => void
  onError?: (error: Error) => void
}): PowerMonitorRecovery {
  const monitor = options.monitor ?? powerMonitor
  let started = false
  let suspendedAt: number | null = null

  const handleSuspend = (): void => {
    suspendedAt = Date.now()
    console.info(`[agents-desktop] System suspended.`)
  }
  const handleResume = (): void => {
    const elapsedMs = suspendedAt === null ? null : Date.now() - suspendedAt
    suspendedAt = null
    console.info(
      `[agents-desktop] System resumed${elapsedMs === null ? `` : ` after ${elapsedMs}ms`}; reconnecting pull-wake streams.`
    )
    try {
      options.onResume()
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (options.onError) options.onError(error)
      else console.warn(`[agents-desktop] Resume recovery failed:`, error)
    }
  }

  return {
    start(): void {
      if (started) return
      started = true
      monitor.on(`suspend`, handleSuspend)
      monitor.on(`resume`, handleResume)
    },
    stop(): void {
      if (!started) return
      started = false
      monitor.removeListener(`suspend`, handleSuspend)
      monitor.removeListener(`resume`, handleResume)
      suspendedAt = null
    },
  }
}
