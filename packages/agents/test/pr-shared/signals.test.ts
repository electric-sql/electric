import { describe, expect, it, vi } from 'vitest'
import {
  SIGNAL_TYPES,
  insertSignal,
  markConsumed,
  isConsumed,
} from '../../src/agents/pr-shared/signals'

describe(`signals vocabulary`, () => {
  it(`declares all 18 signal types from §3.3`, () => {
    expect(SIGNAL_TYPES).toEqual([
      `pr_synced`,
      `head_sha_changed`,
      `ci_failed`,
      `ci_passed`,
      `new_human_comment`,
      `review_complete`,
      `review_skipped`,
      `commits_pushed`,
      `base_advanced`,
      `label_changed`,
      `agents_label_removed`,
      `agents_label_restored`,
      `pr_closed`,
      `human_input_required`,
      `continue_granted`,
      `agents_disabled`,
      `gate_state_changed`,
      `ready_to_merge`,
    ])
  })
})

describe(`insertSignal`, () => {
  it(`inserts a row with auto key, iso ts, empty consumed_by`, () => {
    const insert = vi.fn()
    const collection = { insert } as unknown as { insert: (r: unknown) => void }
    insertSignal(collection as any, `head_sha_changed`, {
      from_sha: `a`,
      to_sha: `b`,
      author_login: `me`,
    })
    expect(insert).toHaveBeenCalledTimes(1)
    const row = insert.mock.calls[0]![0] as {
      key: string
      type: string
      payload: unknown
      ts: string
      consumed_by: string[]
    }
    expect(row.type).toBe(`head_sha_changed`)
    expect(row.payload).toEqual({
      from_sha: `a`,
      to_sha: `b`,
      author_login: `me`,
    })
    expect(row.consumed_by).toEqual([])
    expect(row.key).toMatch(/^[A-Za-z0-9_-]{12,}$/)
    expect(new Date(row.ts).toString()).not.toBe(`Invalid Date`)
  })
})

describe(`isConsumed / markConsumed`, () => {
  it(`isConsumed returns true when role appears in array`, () => {
    expect(isConsumed({ consumed_by: [`reviewer`] } as any, `reviewer`)).toBe(
      true
    )
    expect(isConsumed({ consumed_by: [] } as any, `reviewer`)).toBe(false)
  })

  it(`markConsumed appends role idempotently via collection.update`, () => {
    const draft = { consumed_by: [`reviewer`] }
    const update = vi.fn((_key, fn) => fn(draft))
    markConsumed({ update } as any, `sig-1`, `reviewer`)
    expect(draft.consumed_by).toEqual([`reviewer`])
    markConsumed({ update } as any, `sig-1`, `build-doctor`)
    expect(draft.consumed_by).toEqual([`reviewer`, `build-doctor`])
  })
})

describe(`insertSignal key uniqueness`, () => {
  it(`generates a distinct key for each insertion`, () => {
    const insert = vi.fn()
    insertSignal({ insert } as any, `pr_synced`, {})
    insertSignal({ insert } as any, `pr_synced`, {})
    const k1 = (insert.mock.calls[0]![0] as { key: string }).key
    const k2 = (insert.mock.calls[1]![0] as { key: string }).key
    expect(k1).not.toBe(k2)
  })
})
