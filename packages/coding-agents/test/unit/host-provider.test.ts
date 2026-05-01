import { describe, it, expect } from 'vitest'
import { HostProvider } from '../../src/providers/host'

describe(`HostProvider construction`, () => {
  it(`exposes name "host"`, () => {
    const p = new HostProvider()
    expect(p.name).toBe(`host`)
  })
})

describe(`HostProvider.start`, () => {
  it(`rejects a volume workspace`, async () => {
    const p = new HostProvider()
    await expect(
      p.start({
        agentId: `/t/coding-agent/x`,
        kind: `claude`,
        target: `host`,
        workspace: { type: `volume`, name: `w` },
        env: {},
      })
    ).rejects.toThrow(/HostProvider requires a bindMount workspace/)
  })
})
