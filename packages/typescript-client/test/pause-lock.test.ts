import { describe, it, expect, vi } from 'vitest'
import { PauseLock } from '../src/pause-lock'

describe(`PauseLock`, () => {
  function createLock() {
    const onAcquired = vi.fn()
    const onReleased = vi.fn()
    const lock = new PauseLock({ onAcquired, onReleased })
    return { lock, onAcquired, onReleased }
  }

  it(`starts unlocked`, () => {
    const { lock } = createLock()
    expect(lock.isPaused).toBe(false)
  })

  it(`acquire transitions to locked and fires onAcquired`, () => {
    const { lock, onAcquired, onReleased } = createLock()
    lock.acquire(`visibility`)
    expect(lock.isPaused).toBe(true)
    expect(lock.isHeldBy(`visibility`)).toBe(true)
    expect(onAcquired).toHaveBeenCalledOnce()
    expect(onReleased).not.toHaveBeenCalled()
  })

  it(`release transitions to unlocked and fires onReleased`, () => {
    const { lock, onAcquired, onReleased } = createLock()
    lock.acquire(`visibility`)
    lock.release(`visibility`)
    expect(lock.isPaused).toBe(false)
    expect(lock.isHeldBy(`visibility`)).toBe(false)
    expect(onAcquired).toHaveBeenCalledOnce()
    expect(onReleased).toHaveBeenCalledOnce()
  })

  it(`multiple reasons: stays locked until all released`, () => {
    const { lock, onAcquired, onReleased } = createLock()
    lock.acquire(`visibility`)
    lock.acquire(`snapshot-1`)

    expect(lock.isPaused).toBe(true)
    expect(onAcquired).toHaveBeenCalledOnce() // only on first acquire

    lock.release(`snapshot-1`)
    expect(lock.isPaused).toBe(true) // visibility still held
    expect(onReleased).not.toHaveBeenCalled()

    lock.release(`visibility`)
    expect(lock.isPaused).toBe(false)
    expect(onReleased).toHaveBeenCalledOnce()
  })

  it(`snapshot resume while tab hidden: stream stays paused`, () => {
    const { lock, onReleased } = createLock()

    // Tab visible, snapshot starts
    lock.acquire(`snapshot-1`)
    expect(lock.isPaused).toBe(true)

    // Tab goes hidden while snapshot is in progress
    lock.acquire(`visibility`)
    expect(lock.isPaused).toBe(true)

    // Snapshot completes
    lock.release(`snapshot-1`)
    expect(lock.isPaused).toBe(true) // visibility still held!
    expect(onReleased).not.toHaveBeenCalled()

    // Tab becomes visible
    lock.release(`visibility`)
    expect(lock.isPaused).toBe(false)
    expect(onReleased).toHaveBeenCalledOnce()
  })

  it(`visibility resume during snapshot: stream stays paused`, () => {
    const { lock, onReleased } = createLock()

    // Tab hidden
    lock.acquire(`visibility`)

    // Snapshot starts while tab hidden
    lock.acquire(`snapshot-1`)

    // Tab becomes visible
    lock.release(`visibility`)
    expect(lock.isPaused).toBe(true) // snapshot still held!
    expect(onReleased).not.toHaveBeenCalled()

    // Snapshot completes
    lock.release(`snapshot-1`)
    expect(lock.isPaused).toBe(false)
    expect(onReleased).toHaveBeenCalledOnce()
  })

  it(`multiple concurrent snapshots`, () => {
    const { lock, onAcquired, onReleased } = createLock()

    lock.acquire(`snapshot-1`)
    lock.acquire(`snapshot-2`)
    lock.acquire(`snapshot-3`)
    expect(onAcquired).toHaveBeenCalledOnce()

    lock.release(`snapshot-1`)
    lock.release(`snapshot-2`)
    expect(lock.isPaused).toBe(true)
    expect(onReleased).not.toHaveBeenCalled()

    lock.release(`snapshot-3`)
    expect(lock.isPaused).toBe(false)
    expect(onReleased).toHaveBeenCalledOnce()
  })

  it(`double acquire is idempotent and warns`, () => {
    const { lock, onAcquired } = createLock()
    const warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    lock.acquire(`visibility`)
    lock.acquire(`visibility`)
    expect(onAcquired).toHaveBeenCalledOnce()
    expect(lock.isPaused).toBe(true)
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`"visibility" already held`)
    )
    warnSpy.mockRestore()
  })

  it(`releasing unheld reason is a no-op`, () => {
    const { lock, onReleased } = createLock()
    lock.release(`nonexistent`)
    expect(lock.isPaused).toBe(false)
    expect(onReleased).not.toHaveBeenCalled()
  })

  it(`releaseAllMatching clears matching holders without firing onReleased`, () => {
    const { lock, onReleased } = createLock()
    lock.acquire(`snapshot-1`)
    lock.acquire(`snapshot-2`)
    lock.releaseAllMatching(`snapshot`)
    expect(lock.isPaused).toBe(false)
    expect(lock.isHeldBy(`snapshot-1`)).toBe(false)
    expect(lock.isHeldBy(`snapshot-2`)).toBe(false)
    expect(onReleased).not.toHaveBeenCalled()
  })

  it(`releaseAllMatching preserves non-matching holders`, () => {
    const { lock, onReleased } = createLock()
    lock.acquire(`visibility`)
    lock.acquire(`snapshot-1`)
    lock.releaseAllMatching(`snapshot`)
    expect(lock.isPaused).toBe(true) // visibility still held
    expect(lock.isHeldBy(`visibility`)).toBe(true)
    expect(lock.isHeldBy(`snapshot-1`)).toBe(false)
    expect(onReleased).not.toHaveBeenCalled()
  })

  it(`can re-acquire after releaseAllMatching`, () => {
    const { lock, onAcquired } = createLock()
    lock.acquire(`snapshot-1`)
    lock.releaseAllMatching(`snapshot`)
    onAcquired.mockClear()

    lock.acquire(`snapshot-2`)
    expect(lock.isPaused).toBe(true)
    expect(onAcquired).toHaveBeenCalledOnce()
  })

  it(`rapid acquire + release before checking: lock is empty`, () => {
    const { lock, onAcquired, onReleased } = createLock()
    lock.acquire(`visibility`)
    lock.release(`visibility`)
    expect(lock.isPaused).toBe(false)
    expect(onAcquired).toHaveBeenCalledOnce()
    expect(onReleased).toHaveBeenCalledOnce()
  })
})
