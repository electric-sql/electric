import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { LocalDockerProvider } from '../../src/providers/local-docker'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const SHOULD = process.env.DOCKER === `1`
const d = SHOULD ? describe : describe.skip

d(`LocalDockerProvider.cloneWorkspace`, () => {
  let provider!: LocalDockerProvider
  const created: Array<string> = []

  beforeAll(() => {
    provider = new LocalDockerProvider()
  })

  afterEach(async () => {
    for (const v of created.splice(0)) {
      await execFileP(`docker`, [`volume`, `rm`, `-f`, v]).catch(
        () => undefined
      )
    }
  })

  it(`copies all files from source volume into target volume`, async () => {
    const suffix = Date.now().toString(36)
    const source = `electric-ax-test-clone-src-${suffix}`
    const target = `electric-ax-test-clone-dst-${suffix}`
    created.push(source, target)

    // Seed source volume with a sentinel file via a one-shot container.
    await execFileP(`docker`, [`volume`, `create`, source])
    await execFileP(`docker`, [`volume`, `create`, target])
    await execFileP(`docker`, [
      `run`,
      `--rm`,
      `-v`,
      `${source}:/work`,
      `alpine`,
      `sh`,
      `-c`,
      `echo hello > /work/sentinel.txt && mkdir -p /work/sub && echo nested > /work/sub/n.txt`,
    ])

    await provider.cloneWorkspace!({
      source: { type: `volume`, name: source },
      target: { type: `volume`, name: target },
    })

    // Verify target has both files.
    const { stdout: rootContent } = await execFileP(`docker`, [
      `run`,
      `--rm`,
      `-v`,
      `${target}:/work`,
      `alpine`,
      `cat`,
      `/work/sentinel.txt`,
    ])
    expect(rootContent.trim()).toBe(`hello`)

    const { stdout: nestedContent } = await execFileP(`docker`, [
      `run`,
      `--rm`,
      `-v`,
      `${target}:/work`,
      `alpine`,
      `cat`,
      `/work/sub/n.txt`,
    ])
    expect(nestedContent.trim()).toBe(`nested`)
  }, 60_000)

  it(`fails fast if source volume is missing`, async () => {
    const target = `electric-ax-test-clone-target-only-${Date.now().toString(36)}`
    created.push(target)
    await execFileP(`docker`, [`volume`, `create`, target])

    await expect(
      provider.cloneWorkspace!({
        source: { type: `volume`, name: `does-not-exist-${Date.now()}` },
        target: { type: `volume`, name: target },
      })
    ).rejects.toThrow()
  }, 30_000)

  it(`rejects bind-mount source (volume-only)`, async () => {
    await expect(
      provider.cloneWorkspace!({
        source: { type: `bindMount`, hostPath: `/tmp` },
        target: { type: `volume`, name: `whatever` },
      })
    ).rejects.toThrow(/bindMount/i)
  })
})
