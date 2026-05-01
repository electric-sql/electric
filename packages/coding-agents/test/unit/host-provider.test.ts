import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  stat as statFs,
} from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
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

  it(`exposes homeDir = os.homedir() on the started instance`, async () => {
    // Regression: handler.ts used to hardcode '/home/agent' when
    // materialising/capturing the resume transcript. On the host that
    // path doesn't exist (e.g. /home is read-only on macOS) and pinned
    // the agent to status=error on the second turn. The fix routes the
    // home directory through SandboxInstance.homeDir.
    const p = new HostProvider()
    const agentId = `/t/coding-agent/homedir-${Date.now().toString(36)}`
    const inst = await p.start({
      agentId,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: {},
    })
    try {
      expect(inst.homeDir).toBe(os.homedir())
    } finally {
      await p.destroy(agentId)
    }
  })

  it(`recover always returns an empty array`, async () => {
    const p = new HostProvider()
    expect(await p.recover()).toEqual([])
  })
})

describe(`HostProvider exec`, () => {
  let dir: string
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), `host-prov-exec-`)))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it(`runs a child and drains stdout`, async () => {
    const p = new HostProvider()
    const agentId = `/t/coding-agent/exec-${Date.now()}`
    const inst = await p.start({
      agentId,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: {},
    })
    const handle = await inst.exec({
      cmd: [`node`, `-e`, `process.stdout.write("hi\\n")`],
    })
    let out = ``
    for await (const line of handle.stdout) out += line
    const exit = await handle.wait()
    expect(exit.exitCode).toBe(0)
    expect(out).toBe(`hi`)
  })

  it(`exposes only spec.env (+ inherited PATH) to the child`, async () => {
    const p = new HostProvider()
    process.env.HOST_PROVIDER_LEAK = `secret`
    const agentId = `/t/coding-agent/env-${Date.now()}`
    const inst = await p.start({
      agentId,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: { ALLOWED: `yes` },
    })
    const handle = await inst.exec({
      cmd: [
        `node`,
        `-e`,
        `process.stdout.write(JSON.stringify({allowed:process.env.ALLOWED ?? "", leak:process.env.HOST_PROVIDER_LEAK ?? ""}))`,
      ],
    })
    let out = ``
    for await (const line of handle.stdout) out += line
    await handle.wait()
    delete process.env.HOST_PROVIDER_LEAK
    const parsed = JSON.parse(out)
    expect(parsed.allowed).toBe(`yes`)
    expect(parsed.leak).toBe(``)
  })
})

describe(`HostProvider copyTo`, () => {
  let dir: string
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), `host-prov-copy-`)))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it(`writes the content with the requested mode`, async () => {
    const p = new HostProvider()
    const agentId = `/t/coding-agent/copy-${Date.now()}`
    const inst = await p.start({
      agentId,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: dir },
      env: {},
    })
    const dest = join(dir, `nested`, `file.txt`)
    await inst.copyTo({ destPath: dest, content: `payload`, mode: 0o600 })
    const contents = await readFile(dest, `utf8`)
    expect(contents).toBe(`payload`)
    const s = await statFs(dest)
    expect(s.mode & 0o777).toBe(0o600)
  })
})
