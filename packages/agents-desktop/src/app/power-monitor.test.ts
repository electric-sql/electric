import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
vi.mock(`electron`, () => ({
  powerMonitor: new EventEmitter(),
}))

import { createPowerMonitorRecovery } from './power-monitor'

class FakePowerMonitor extends EventEmitter {
  listenerCountFor(event: `suspend` | `resume`): number {
    return this.listenerCount(event)
  }
}

describe(`power monitor recovery`, () => {
  it(`runs resume recovery once and does not duplicate listeners`, () => {
    const monitor = new FakePowerMonitor()
    const onResume = vi.fn()
    const recovery = createPowerMonitorRecovery({ monitor, onResume })

    recovery.start()
    recovery.start()
    expect(monitor.listenerCountFor(`suspend`)).toBe(1)
    expect(monitor.listenerCountFor(`resume`)).toBe(1)

    monitor.emit(`suspend`)
    monitor.emit(`resume`)
    expect(onResume).toHaveBeenCalledTimes(1)

    recovery.stop()
    expect(monitor.listenerCountFor(`suspend`)).toBe(0)
    expect(monitor.listenerCountFor(`resume`)).toBe(0)
  })

  it(`reports resume callback failures without throwing from the event`, () => {
    const monitor = new FakePowerMonitor()
    const onError = vi.fn()
    const recovery = createPowerMonitorRecovery({
      monitor,
      onResume: () => {
        throw new Error(`resume failed`)
      },
      onError,
    })
    recovery.start()

    expect(() => monitor.emit(`resume`)).not.toThrow()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: `resume failed` })
    )
  })
})
