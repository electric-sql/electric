import { describe, expect, it } from 'vitest'
import {
  STALE_RUNNING_MS,
  isRunningCheckpointOrphaned,
} from './compactionIndicator'

describe(`isRunningCheckpointOrphaned`, () => {
  const now = 1_000_000_000_000
  const iso = (ms: number) => new Date(ms).toISOString()

  it(`is NOT orphaned for a fresh running checkpoint`, () => {
    expect(isRunningCheckpointOrphaned(iso(now), now)).toBe(false)
    expect(isRunningCheckpointOrphaned(iso(now - 30_000), now)).toBe(false)
  })

  it(`is NOT orphaned just under the staleness deadline`, () => {
    expect(
      isRunningCheckpointOrphaned(iso(now - (STALE_RUNNING_MS - 1)), now)
    ).toBe(false)
  })

  it(`IS orphaned at/after the staleness deadline (crashed mid-summarize)`, () => {
    expect(isRunningCheckpointOrphaned(iso(now - STALE_RUNNING_MS), now)).toBe(
      true
    )
    expect(
      isRunningCheckpointOrphaned(iso(now - STALE_RUNNING_MS * 10), now)
    ).toBe(true)
  })

  it(`treats a missing or unparseable timestamp as NOT orphaned`, () => {
    // We can't prove staleness, so we keep showing the spinner rather than hide
    // a possibly-live compaction. (insertContext always stamps a timestamp.)
    expect(isRunningCheckpointOrphaned(undefined, now)).toBe(false)
    expect(isRunningCheckpointOrphaned(``, now)).toBe(false)
    expect(isRunningCheckpointOrphaned(`not-a-date`, now)).toBe(false)
  })
})
