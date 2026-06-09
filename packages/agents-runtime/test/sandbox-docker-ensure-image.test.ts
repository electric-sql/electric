import { describe, expect, it, vi } from 'vitest'
import { ensureImage } from '../src/sandbox/docker'

/**
 * Unit test (no daemon) for the image-pull policy. `pullIfMissing` is
 * documented as "pulls the image when it's not present locally", and
 * `docker.pull` always round-trips to the registry — even for a fully cached
 * digest — so pulling unconditionally made every container create hostage to
 * registry reachability. These assert the documented presence-based contract.
 */

function fakeDocker(present: boolean) {
  const inspect = vi.fn(async () => {
    if (present) return {} as unknown
    const err = new Error(`no such image`) as Error & { statusCode?: number }
    err.statusCode = 404
    throw err
  })
  const pull = vi.fn(async () => ({}) as unknown)
  const docker = {
    getImage: vi.fn(() => ({ inspect })),
    pull,
    modem: {
      followProgress: (_stream: unknown, onDone: (err: unknown) => void) =>
        onDone(null),
    },
  }
  return { docker, inspect, pull }
}

describe(`ensureImage`, () => {
  it(`skips the pull when the image is already present (no registry round-trip)`, async () => {
    const { docker, inspect, pull } = fakeDocker(true)
    await ensureImage(docker as never, `img@sha256:abc`, {})
    expect(inspect).toHaveBeenCalledOnce()
    expect(pull).not.toHaveBeenCalled()
  })

  it(`pulls when the image is absent`, async () => {
    const { docker, pull } = fakeDocker(false)
    await ensureImage(docker as never, `img@sha256:abc`, {})
    expect(pull).toHaveBeenCalledOnce()
  })

  it(`does nothing when pullIfMissing is false (fail-fast / pre-pulled)`, async () => {
    const { docker, inspect, pull } = fakeDocker(true)
    await ensureImage(docker as never, `img@sha256:abc`, {
      pullIfMissing: false,
    })
    expect(inspect).not.toHaveBeenCalled()
    expect(pull).not.toHaveBeenCalled()
  })
})
