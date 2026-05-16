import { describe, expect, it, vi } from 'vitest'
import {
  worktreePathFor,
  tryAcquireLock,
  releaseLock,
} from '../../src/agents/pr-shared/worktree'

describe(`worktreePathFor`, () => {
  it(`returns <repoRoot>/.worktrees/pr-<n>`, () => {
    expect(worktreePathFor(`/tmp/repo`, 42)).toBe(`/tmp/repo/.worktrees/pr-42`)
  })
})

describe(`lock`, () => {
  it(`tryAcquireLock sets holder when free, returns true`, () => {
    const update = vi.fn((_k, fn) => fn({ worktree_lock_holder: null }))
    const got = tryAcquireLock({ update } as any, `reviewer`, `reviewer`)
    expect(got).toBe(true)
    expect(update).toHaveBeenCalled()
  })
  it(`tryAcquireLock returns false when held by another role`, () => {
    const update = vi.fn((_k, fn) => {
      const draft = { worktree_lock_holder: `build-doctor` }
      try {
        fn(draft)
      } catch {
        /* ignored */
      }
    })
    const got = tryAcquireLock({ update } as any, `reviewer`, `reviewer`, {
      peek: () => `build-doctor`,
    })
    expect(got).toBe(false)
  })
  it(`releaseLock clears holder`, () => {
    const update = vi.fn((_k, fn) => fn({ worktree_lock_holder: `reviewer` }))
    releaseLock({ update } as any, `reviewer`)
    expect(update).toHaveBeenCalled()
  })
})
