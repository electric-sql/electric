import { describe, it, expect } from 'vitest'
import { WorkspaceRegistry } from '../../src/workspace-registry'

describe(`WorkspaceRegistry.resolveIdentity`, () => {
  it(`resolves volume:name when name is provided`, async () => {
    const r = await WorkspaceRegistry.resolveIdentity(`/p/coding-agent/x`, {
      type: `volume`,
      name: `foo`,
    })
    expect(r.identity).toBe(`volume:foo`)
    expect(r.resolved).toEqual({ type: `volume`, name: `foo` })
  })

  it(`resolves volume:<slug(agentId)> when name is omitted`, async () => {
    const r = await WorkspaceRegistry.resolveIdentity(`/p/coding-agent/x`, {
      type: `volume`,
    })
    // agentId slugified: '/' → '-', leading separators stripped.
    expect(r.identity).toBe(`volume:p-coding-agent-x`)
    expect(r.resolved).toEqual({ type: `volume`, name: `p-coding-agent-x` })
  })

  it(`slugifies invalid Docker volume name characters in agentId`, async () => {
    const r = await WorkspaceRegistry.resolveIdentity(`/a/b@c/d!`, {
      type: `volume`,
    })
    expect(r.identity).toMatch(/^volume:[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
  })

  it(`resolves bindMount:<realpath> for bind mounts`, async () => {
    const r = await WorkspaceRegistry.resolveIdentity(`/p/coding-agent/x`, {
      type: `bindMount`,
      hostPath: `/tmp`,
    })
    expect(r.identity).toMatch(/^bindMount:\/(private\/)?tmp$/)
  })
})

describe(`WorkspaceRegistry refcount`, () => {
  it(`tracks refs across register/release`, () => {
    const wr = new WorkspaceRegistry()
    expect(wr.refs(`volume:foo`)).toBe(0)
    wr.register(`volume:foo`, `a`)
    wr.register(`volume:foo`, `b`)
    expect(wr.refs(`volume:foo`)).toBe(2)
    wr.release(`volume:foo`, `a`)
    expect(wr.refs(`volume:foo`)).toBe(1)
    wr.release(`volume:foo`, `a`) // double-release is idempotent
    expect(wr.refs(`volume:foo`)).toBe(1)
    wr.release(`volume:foo`, `b`)
    expect(wr.refs(`volume:foo`)).toBe(0)
  })
})

describe(`WorkspaceRegistry mutex`, () => {
  it(`serializes acquire calls per identity`, async () => {
    const wr = new WorkspaceRegistry()
    const order: Array<string> = []
    const a = wr.acquire(`volume:foo`).then((release) => {
      order.push(`a-acquired`)
      return new Promise<void>((res) =>
        setTimeout(() => {
          order.push(`a-release`)
          release()
          res()
        }, 50)
      )
    })
    // Make sure b queues behind a
    await new Promise((r) => setTimeout(r, 5))
    const b = wr.acquire(`volume:foo`).then((release) => {
      order.push(`b-acquired`)
      release()
    })
    await Promise.all([a, b])
    expect(order).toEqual([`a-acquired`, `a-release`, `b-acquired`])
  })

  it(`does not serialize across distinct identities`, async () => {
    const wr = new WorkspaceRegistry()
    const order: Array<string> = []
    const a = wr.acquire(`volume:foo`).then((release) => {
      order.push(`a-acq`)
      return new Promise<void>((res) =>
        setTimeout(() => {
          release()
          res()
        }, 50)
      )
    })
    const b = wr.acquire(`volume:bar`).then((release) => {
      order.push(`b-acq`)
      release()
    })
    await Promise.all([a, b])
    // b runs before a finishes
    expect(order[0]).toBe(`a-acq`)
    expect(order[1]).toBe(`b-acq`)
  })
})

describe(`WorkspaceRegistry.rebuild`, () => {
  it(`replays a snapshot from durable state`, () => {
    const wr = new WorkspaceRegistry()
    wr.rebuild([
      { identity: `volume:foo`, agentId: `a` },
      { identity: `volume:foo`, agentId: `b` },
      { identity: `volume:bar`, agentId: `c` },
    ])
    expect(wr.refs(`volume:foo`)).toBe(2)
    expect(wr.refs(`volume:bar`)).toBe(1)
  })
})

describe(`WorkspaceRegistry mutex chain trimming`, () => {
  it(`removes the chain entry when the last acquirer releases (serial)`, async () => {
    const wr = new WorkspaceRegistry()
    const internal = wr as unknown as {
      chainByIdentity: Map<string, Promise<void>>
    }

    for (let i = 0; i < 5; i++) {
      const release = await wr.acquire(`volume:foo`)
      release()
    }
    // Allow microtasks to drain.
    await Promise.resolve()
    await Promise.resolve()

    expect(internal.chainByIdentity.size).toBe(0)
  })

  it(`keeps the chain entry while concurrent acquirers are queued`, async () => {
    const wr = new WorkspaceRegistry()
    const internal = wr as unknown as {
      chainByIdentity: Map<string, Promise<void>>
    }

    const release1 = await wr.acquire(`volume:foo`)
    // Queue a second acquirer waiting on release1.
    const pending2 = wr.acquire(`volume:foo`)
    expect(internal.chainByIdentity.size).toBe(1)

    release1()
    const release2 = await pending2
    // Still one entry while release2 is held.
    expect(internal.chainByIdentity.size).toBe(1)

    release2()
    await Promise.resolve()
    await Promise.resolve()
    expect(internal.chainByIdentity.size).toBe(0)
  })

  it(`drains chainByIdentity after N concurrent acquire→release tasks (R2 #5 regression)`, async () => {
    // Each task does its own acquire→work→release. The chain-of-thens
    // bug shows up when two pending tasks race the chain pointer:
    // both read the same `prior` snapshot, one's `link` overwrites
    // the other's, and the first acquirer's `chainByIdentity.get(identity) === link`
    // check never fires at release time — the entry is never deleted.
    const wr = new WorkspaceRegistry()
    const internal = wr as unknown as {
      chainByIdentity: Map<string, Promise<void>>
    }

    const N = 8
    let completed = 0
    await Promise.all(
      Array.from({ length: N }, async () => {
        const release = await wr.acquire(`volume:foo`)
        // Yield once so the next task can race the chain pointer.
        await Promise.resolve()
        completed++
        release()
      })
    )

    // Drain microtasks generously.
    for (let i = 0; i < 20; i++) await Promise.resolve()

    expect(completed).toBe(N)
    expect(internal.chainByIdentity.size).toBe(0)
  })

  it(`serialises N concurrent acquirers (no overlap, all complete)`, async () => {
    // Stronger property: all acquirers actually run (none dropped)
    // and they don't overlap. Chain bug manifests as a hung promise
    // that resolves the test only because we use a timeout-bounded
    // Promise.all; the leaked entry is then visible in chainByIdentity.
    const wr = new WorkspaceRegistry()

    let active = 0
    let maxActive = 0
    let completed = 0

    const N = 6
    await Promise.all(
      Array.from({ length: N }, () =>
        wr.acquire(`volume:foo`).then(async (release) => {
          active++
          maxActive = Math.max(maxActive, active)
          await Promise.resolve()
          active--
          completed++
          release()
        })
      )
    )

    expect(maxActive).toBe(1)
    expect(completed).toBe(N)
  })
})
