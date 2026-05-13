import { describe, expect, it } from 'vitest'
import { parseDispatchPolicy } from '../src/dispatch-policy-schema'

describe(`parseDispatchPolicy`, () => {
  it(`accepts exactly one webhook target`, () => {
    expect(
      parseDispatchPolicy({
        targets: [{ type: `webhook`, url: `https://handler.test/wake` }],
      })
    ).toEqual({
      targets: [{ type: `webhook`, url: `https://handler.test/wake` }],
    })
  })

  it(`accepts exactly one runner target`, () => {
    expect(
      parseDispatchPolicy({
        targets: [{ type: `runner`, runnerId: `runner-1` }],
      })
    ).toEqual({ targets: [{ type: `runner`, runnerId: `runner-1` }] })
  })

  it(`accepts a subscription id for the target`, () => {
    expect(
      parseDispatchPolicy({
        targets: [
          {
            type: `runner`,
            runnerId: `runner-1`,
            subscription_id: `runner:runner-1`,
          },
        ],
      })
    ).toEqual({
      targets: [
        {
          type: `runner`,
          runnerId: `runner-1`,
          subscription_id: `runner:runner-1`,
        },
      ],
    })
  })

  it(`rejects malformed policies`, () => {
    expect(() => parseDispatchPolicy(null)).toThrow(/dispatch policy schema/)
    expect(() => parseDispatchPolicy({})).toThrow(/dispatch policy schema/)
    expect(() => parseDispatchPolicy({ targets: [] })).toThrow(
      /dispatch policy schema/
    )
    expect(() =>
      parseDispatchPolicy({
        targets: [
          { type: `runner`, runnerId: `runner-1` },
          { type: `runner`, runnerId: `runner-2` },
        ],
      })
    ).toThrow(/dispatch policy schema/)
  })

  it(`rejects invalid target shapes and unsupported target types`, () => {
    expect(() =>
      parseDispatchPolicy({ targets: [{ type: `webhook` }] })
    ).toThrow(/dispatch policy schema/)
    expect(() =>
      parseDispatchPolicy({ targets: [{ type: `runner` }] })
    ).toThrow(/dispatch policy schema/)
    expect(() =>
      parseDispatchPolicy({
        targets: [{ type: `worker-pool`, workerPoolId: `pool-1` }],
      })
    ).toThrow(/dispatch policy schema/)
  })
})
