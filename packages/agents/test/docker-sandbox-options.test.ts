import { describe, expect, it } from 'vitest'
import { resolveDockerSandboxOpts } from '../src/bootstrap'

const cwdMount = {
  hostPath: `/home/u/project`,
  containerPath: `/work`,
  readOnly: false,
}

describe(`resolveDockerSandboxOpts`, () => {
  it(`returns only the cwd mount when no custom options are given`, () => {
    expect(resolveDockerSandboxOpts(cwdMount, undefined)).toEqual({
      extraMounts: [cwdMount],
    })
  })

  it(`threads image, allowFloatingTag, and env through`, () => {
    expect(
      resolveDockerSandboxOpts(undefined, {
        image: `ghcr.io/acme/sandbox@sha256:abc`,
        allowFloatingTag: false,
        env: { FOO: `bar` },
      })
    ).toEqual({
      image: `ghcr.io/acme/sandbox@sha256:abc`,
      allowFloatingTag: false,
      env: { FOO: `bar` },
    })
  })

  it(`appends custom mounts after the cwd mount`, () => {
    const custom = {
      extraMounts: [
        {
          hostPath: `/secrets/key.pem`,
          containerPath: `/secrets/key.pem`,
          readOnly: true,
        },
      ],
    }
    expect(resolveDockerSandboxOpts(cwdMount, custom)).toEqual({
      extraMounts: [cwdMount, custom.extraMounts[0]],
    })
  })

  it(`returns an empty object when there is nothing to apply`, () => {
    expect(resolveDockerSandboxOpts(undefined, undefined)).toEqual({})
  })
})
