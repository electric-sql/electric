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
