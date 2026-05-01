import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe(`HostProvider lifecycle`, () => {
  let dir: string
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), `host-prov-`)))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it(`start records agent in map; status reflects it; destroy removes it`, async () => {
    const p = new HostProvider()
    const agentId = `/t/coding-agent/${Date.now()}`
    const inst = await p.start({
      agentId,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: {},
    })
    expect(inst.agentId).toBe(agentId)
    expect(inst.workspaceMount).toBe(dir)
    expect(inst.instanceId).toBe(`host:${agentId}`)
    expect(await p.status(agentId)).toBe(`running`)

    await p.destroy(agentId)
    expect(await p.status(agentId)).toBe(`unknown`)
  })

  it(`start is idempotent — second call returns the same instance`, async () => {
    const p = new HostProvider()
    const spec: any = {
      agentId: `/t/coding-agent/idem`,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: {},
    }
    const a = await p.start(spec)
    const b = await p.start(spec)
    expect(b.instanceId).toBe(a.instanceId)
    expect(b.workspaceMount).toBe(a.workspaceMount)
  })

  it(`recover always returns an empty array`, async () => {
    const p = new HostProvider()
    expect(await p.recover()).toEqual([])
  })
})
