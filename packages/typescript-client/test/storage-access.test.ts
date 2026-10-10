import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function denyStorageAccess(): void {
  Object.defineProperty(globalThis, `localStorage`, {
    configurable: true,
    get() {
      throw new DOMException(`Access is denied`, `SecurityError`)
    },
  })
}

describe(`denied localStorage access`, () => {
  let storageDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    storageDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      `localStorage`
    )
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    if (storageDescriptor) {
      Object.defineProperty(globalThis, `localStorage`, storageDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, `localStorage`)
    }
    if (vi.isFakeTimers()) {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
    vi.resetModules()
  })

  it(`imports the public client when storage access is denied`, async () => {
    denyStorageAccess()

    await expect(import(`../src/index`)).resolves.toHaveProperty(`ShapeStream`)
  })

  it(`keeps expired-shapes writes usable when storage becomes denied`, async () => {
    const { ExpiredShapesCache } = await import(`../src/expired-shapes-cache`)
    const cache = new ExpiredShapesCache()
    denyStorageAccess()

    expect(() => cache.markExpired(`shape-1`, `handle-1`)).not.toThrow()
    expect(cache.getExpiredHandle(`shape-1`)).toBe(`handle-1`)
  })

  it(`handles immediate and deferred tracker writes when storage becomes denied`, async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`2026-01-01T00:00:00Z`))
    const { UpToDateTracker } = await import(`../src/up-to-date-tracker`)
    const tracker = new UpToDateTracker()
    denyStorageAccess()

    expect(() => tracker.recordUpToDate(`shape-1`, `cursor-1`)).not.toThrow()
    expect(tracker.shouldEnterReplayMode(`shape-1`)).toBe(`cursor-1`)
    vi.advanceTimersByTime(1_000)
    tracker.recordUpToDate(`shape-2`, `cursor-2`)
    expect(() => vi.advanceTimersByTime(59_000)).not.toThrow()
    expect(tracker.shouldEnterReplayMode(`shape-2`)).toBe(`cursor-2`)
  })
})
