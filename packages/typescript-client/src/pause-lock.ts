/**
 * A set-based counting lock for coordinating multiple pause reasons.
 *
 * Multiple independent subsystems (tab visibility, snapshot requests, etc.)
 * may each need the stream paused. A simple boolean flag or counter can't
 * track *why* the stream is paused, leading to bugs where one subsystem's
 * resume overrides another's pause.
 *
 * PauseLock uses a Set of reason strings. The stream is paused when any
 * reason is held, and only resumes when all reasons are released.
 *
 * @example
 * ```ts
 * const lock = new PauseLock({
 *   onAcquired: () => abortController.abort(),
 *   onReleased: () => startRequestLoop(),
 * })
 *
 * // Tab hidden
 * lock.acquire('visibility')  // → onAcquired fires, stream pauses
 *
 * // Snapshot starts while tab hidden
 * lock.acquire('snapshot-1')  // → no-op, already paused
 *
 * // Snapshot finishes
 * lock.release('snapshot-1')  // → no-op, 'visibility' still held
 *
 * // Tab visible
 * lock.release('visibility')  // → onReleased fires, stream resumes
 * ```
 */
export class PauseLock {
  #holders = new Set<string>()
  #onAcquired: () => void
  #onReleased: () => void

  constructor(callbacks: { onAcquired: () => void; onReleased: () => void }) {
    this.#onAcquired = callbacks.onAcquired
    this.#onReleased = callbacks.onReleased
  }

  /**
   * Acquire the lock for a given reason. Idempotent — acquiring the same
   * reason twice is a no-op (but logs a warning since it likely indicates
   * a caller bug).
   *
   * Fires `onAcquired` when the first reason is acquired (transition from
   * unlocked to locked).
   */
  acquire(reason: string): void {
    if (this.#holders.has(reason)) {
      console.warn(
        `[Electric] PauseLock: "${reason}" already held — ignoring duplicate acquire`
      )
      return
    }
    const wasUnlocked = this.#holders.size === 0
    this.#holders.add(reason)
    if (wasUnlocked) {
      this.#onAcquired()
    }
  }

  /**
   * Release the lock for a given reason. Releasing a reason that isn't
   * held is a no-op.
   *
   * Fires `onReleased` when the last reason is released (transition from
   * locked to unlocked).
   */
  release(reason: string): void {
    if (!this.#holders.delete(reason)) {
      return
    }
    if (this.#holders.size === 0) {
      this.#onReleased()
    }
  }

  /**
   * Whether the lock is currently held by any reason.
   */
  get isPaused(): boolean {
    return this.#holders.size > 0
  }

  /**
   * Check if a specific reason is holding the lock.
   */
  isHeldBy(reason: string): boolean {
    return this.#holders.has(reason)
  }

  /**
   * Release all reasons matching a prefix. Does NOT fire `onReleased` —
   * this is for cleanup/reset paths where the stream state is being
   * managed separately.
   *
   * This preserves reasons with different prefixes (e.g., 'visibility'
   * is preserved when clearing 'snapshot-*' reasons).
   */
  releaseAllMatching(prefix: string): void {
    for (const reason of this.#holders) {
      if (reason.startsWith(prefix)) {
        this.#holders.delete(reason)
      }
    }
  }
}
