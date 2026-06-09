import { describe, expect, it } from 'vitest'
import { recentWorkingDirsForRunner } from './recentWorkingDirectories'
import type { ElectricEntity } from './ElectricAgentsProvider'

const NOW = new Date(`2026-06-04T12:00:00Z`).getTime()

function session(
  url: string,
  runnerId: string | null,
  workingDirectory: unknown,
  updatedAt: number = NOW
): ElectricEntity {
  return {
    url,
    type: `horton`,
    status: `idle`,
    tags: {},
    spawn_args: workingDirectory === undefined ? {} : { workingDirectory },
    dispatch_policy: runnerId
      ? { targets: [{ type: `runner`, runnerId }] }
      : null,
    parent: null,
    created_at: updatedAt,
    updated_at: updatedAt,
  } as unknown as ElectricEntity
}

describe(`recentWorkingDirsForRunner`, () => {
  it(`returns an empty list for no entities`, () => {
    expect(recentWorkingDirsForRunner([], `r1`)).toEqual([])
  })

  it(`only includes entities dispatched to the given runner`, () => {
    const entities = [
      session(`/a`, `r1`, `/home/me/proj-a`),
      session(`/b`, `r2`, `/home/me/proj-b`),
      session(`/c`, null, `/home/me/proj-c`),
    ]
    expect(recentWorkingDirsForRunner(entities, `r1`)).toEqual([
      `/home/me/proj-a`,
    ])
  })

  it(`skips entities without a usable working directory`, () => {
    const entities = [
      session(`/a`, `r1`, undefined),
      session(`/b`, `r1`, ``),
      session(`/c`, `r1`, `   `),
      session(`/d`, `r1`, 42),
      session(`/e`, `r1`, `/real/path`),
    ]
    expect(recentWorkingDirsForRunner(entities, `r1`)).toEqual([`/real/path`])
  })

  it(`orders by most recently used and dedupes paths keeping the newest`, () => {
    const entities = [
      session(`/old-a`, `r1`, `/proj/a`, NOW - 3000),
      session(`/b`, `r1`, `/proj/b`, NOW - 2000),
      session(`/new-a`, `r1`, `/proj/a`, NOW - 1000),
    ]
    expect(recentWorkingDirsForRunner(entities, `r1`)).toEqual([
      `/proj/a`,
      `/proj/b`,
    ])
  })

  it(`caps the list at 10 paths`, () => {
    const entities = Array.from({ length: 15 }, (_, i) =>
      session(`/s${i}`, `r1`, `/proj/${i}`, NOW - i * 1000)
    )
    const recents = recentWorkingDirsForRunner(entities, `r1`)
    expect(recents).toHaveLength(10)
    expect(recents[0]).toBe(`/proj/0`)
    expect(recents[9]).toBe(`/proj/9`)
  })
})
