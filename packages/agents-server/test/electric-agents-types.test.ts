import { describe, expect, it } from 'vitest'
import { assertDispatchPolicy } from '../src/electric-agents-types'

describe(`assertDispatchPolicy`, () => {
  it(`accepts exactly one webhook target`, () => {
    expect(
      assertDispatchPolicy({
        targets: [{ type: `webhook`, url: `https://handler.test/wake` }],
      })
    ).toEqual({
      targets: [{ type: `webhook`, url: `https://handler.test/wake` }],
    })
  })

  it(`accepts exactly one runner target`, () => {
    expect(
      assertDispatchPolicy({
        targets: [{ type: `runner`, runnerId: `runner-1` }],
      })
    ).toEqual({ targets: [{ type: `runner`, runnerId: `runner-1` }] })
  })

  it(`rejects malformed policies`, () => {
    expect(() => assertDispatchPolicy(null)).toThrow(`must be an object`)
    expect(() => assertDispatchPolicy({})).toThrow(`targets must be an array`)
    expect(() => assertDispatchPolicy({ targets: [] })).toThrow(
      `must contain exactly one target`
    )
    expect(() =>
      assertDispatchPolicy({
        targets: [
          { type: `runner`, runnerId: `runner-1` },
          { type: `runner`, runnerId: `runner-2` },
        ],
      })
    ).toThrow(`must contain exactly one target`)
  })

  it(`rejects invalid target shapes and unsupported target types`, () => {
    expect(() =>
      assertDispatchPolicy({ targets: [{ type: `webhook` }] })
    ).toThrow(`url must be a string`)
    expect(() =>
      assertDispatchPolicy({ targets: [{ type: `runner` }] })
    ).toThrow(`runnerId must be a string`)
    expect(() =>
      assertDispatchPolicy({
        targets: [{ type: `worker-pool`, workerPoolId: `pool-1` }],
      })
    ).toThrow(`type must be "webhook" or "runner"`)
  })
})
