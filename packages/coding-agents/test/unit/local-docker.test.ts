import { describe, it, expect, beforeAll } from 'vitest'
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
    } finally {
      await provider.destroy(agentId).catch(() => undefined)
    }
  }, 240_000)
})
