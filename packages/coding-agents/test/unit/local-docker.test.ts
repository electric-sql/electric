import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalDockerProvider } from '../../src/providers/local-docker'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'

describe(`LocalDockerProvider construction`, () => {
  it(`exposes name "local-docker"`, () => {
    const p = new LocalDockerProvider()
    expect(p.name).toBe(`local-docker`)
  })
})

const SHOULD_RUN = process.env.DOCKER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`LocalDockerProvider.copyTo`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`writes a 4 MB UTF-8 string and reads it back unchanged`, async () => {
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const agentId = `/test/coding-agent/copyto-${Date.now().toString(36)}`
    const sandbox = await provider.start({
      agentId,
      kind: `claude`,
      target: `sandbox`,
      workspace: { type: `volume`, name: `copyto-${Date.now().toString(36)}` },
      env: {},
    })
    try {
      const big = `A`.repeat(4 * 1024 * 1024)
      await sandbox.copyTo({
        destPath: `/tmp/big.txt`,
        content: big,
        mode: 0o600,
      })

      const handle = await sandbox.exec({ cmd: [`cat`, `/tmp/big.txt`] })
      let read = ``
      for await (const line of handle.stdout) read += line
      await handle.wait()
      expect(read.length).toBe(big.length)
      expect(read).toBe(big)

      // Verify the requested mode was actually applied.
      const stat = await sandbox.exec({
        cmd: [`stat`, `-c`, `%a`, `/tmp/big.txt`],
      })
      let modeOut = ``
      for await (const line of stat.stdout) modeOut += line
      await stat.wait()
      expect(modeOut.trim()).toBe(`600`)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
    }
  }, 240_000)

  it(`does not expose env values via host argv during exec`, async () => {
    const sentinel = `SLICE_C1_SENTINEL_${Date.now().toString(36)}`
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const agentId = `/test/coding-agent/envleak-${Date.now().toString(36)}`
    const sandbox = await provider.start({
      agentId,
      kind: `claude`,
      target: `sandbox`,
      workspace: {
        type: `volume`,
        name: `envleak-${Date.now().toString(36)}`,
      },
      env: { CANARY: sentinel },
    })
    try {
      // Hold a docker exec process open while we inspect host argv.
      const handle = await sandbox.exec({ cmd: [`sleep`, `2`] })

      const { execSync } = await import(`node:child_process`)
      const ps = execSync(`ps -ef`, { encoding: `utf8` })
      // Sentinel must not appear anywhere in the host process list.
      expect(ps).not.toContain(sentinel)

      await handle.wait()

      // Confirm the env IS visible inside the container — i.e. the env
      // file is being applied, not just absent everywhere.
      const verify = await sandbox.exec({
        cmd: [`sh`, `-c`, `echo $CANARY`],
      })
      let inside = ``
      for await (const line of verify.stdout) inside += line
      await verify.wait()
      expect(inside.trim()).toBe(sentinel)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
    }
  }, 240_000)

  it(`round-trips multi-byte UTF-8 content unchanged`, async () => {
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const agentId = `/test/coding-agent/copyto-utf8-${Date.now().toString(36)}`
    const sandbox = await provider.start({
      agentId,
      kind: `claude`,
      target: `sandbox`,
      workspace: {
        type: `volume`,
        name: `copyto-utf8-${Date.now().toString(36)}`,
      },
      env: {},
    })
    try {
      const content = `樹\n🌲 forest\nüñîçødé\n` + `日本語`.repeat(1000)
      await sandbox.copyTo({ destPath: `/tmp/utf8.txt`, content })

      const handle = await sandbox.exec({ cmd: [`cat`, `/tmp/utf8.txt`] })
      let read = ``
      for await (const line of handle.stdout) read += line + `\n`
      await handle.wait()
      // The line reader appends '\n' per line; the input already ends
      // without a trailing newline, so trim one off before comparing.
      expect(read.replace(/\n$/, ``)).toBe(content)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
    }
  }, 240_000)
})

describeMaybe(`LocalDockerProvider mount alignment`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`bindMount workspace is mounted at realpath(hostPath) and instance.workspaceMount matches`, async () => {
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const tmp = await mkdtemp(join(tmpdir(), `mount-align-`))
    const real = await realpath(tmp)
    const agentId = `/test/coding-agent/align-${Date.now().toString(36)}`
    try {
      const inst = await provider.start({
        agentId,
        kind: `claude`,
        target: `sandbox`,
        workspace: { type: `bindMount`, hostPath: tmp },
        env: {},
      })
      expect(inst.workspaceMount).toBe(real)
      const handle = await inst.exec({ cmd: [`pwd`] })
      let cwd = ``
      for await (const line of handle.stdout) cwd += line
      await handle.wait()
      expect(cwd.trim()).toBe(real)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
      await rm(tmp, { recursive: true, force: true })
    }
  }, 240_000)

  it(`volume workspace still mounts at /workspace`, async () => {
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const agentId = `/test/coding-agent/vol-${Date.now().toString(36)}`
    try {
      const inst = await provider.start({
        agentId,
        kind: `claude`,
        target: `sandbox`,
        workspace: { type: `volume`, name: `vol-${Date.now().toString(36)}` },
        env: {},
      })
      expect(inst.workspaceMount).toBe(`/workspace`)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
    }
  }, 240_000)

  it(`exposes homeDir = '/home/agent' on the started instance`, async () => {
    // Counterpart to the HostProvider regression: docker user is `agent`
    // with a fixed home of /home/agent. Handler resume materialise/capture
    // now reads sandbox.homeDir instead of hardcoding the path.
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const agentId = `/test/coding-agent/homedir-${Date.now().toString(36)}`
    try {
      const inst = await provider.start({
        agentId,
        kind: `claude`,
        target: `sandbox`,
        workspace: {
          type: `volume`,
          name: `homedir-${Date.now().toString(36)}`,
        },
        env: {},
      })
      expect(inst.homeDir).toBe(`/home/agent`)
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
    }
  }, 240_000)
})
