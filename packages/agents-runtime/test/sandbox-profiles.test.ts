import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRuntimeRouter } from '../src/create-handler'
import { clearRegistry } from '../src/define-entity'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'
import type { SandboxProfile } from '../src/sandbox/types'

const localProfile: SandboxProfile = {
  name: `local`,
  label: `Local`,
  description: `Runs on the host`,
  factory: () => unrestrictedSandbox({ workingDirectory: process.cwd() }),
}

const dockerProfile: SandboxProfile = {
  name: `docker`,
  label: `Docker`,
  factory: () => unrestrictedSandbox({ workingDirectory: process.cwd() }),
}

describe(`createRuntimeRouter sandboxProfiles`, () => {
  beforeEach(() => clearRegistry())
  afterEach(() => clearRegistry())

  it(`exposes wire-shape descriptors for the registered profiles`, () => {
    const router = createRuntimeRouter({
      baseUrl: `http://localhost:4200`,
      sandboxProfiles: [localProfile, dockerProfile],
    })
    expect(router.sandboxProfileDescriptors).toEqual([
      { name: `local`, label: `Local`, description: `Runs on the host` },
      { name: `docker`, label: `Docker` },
    ])
  })

  it(`exposes no descriptors when no profiles are registered`, () => {
    const router = createRuntimeRouter({ baseUrl: `http://localhost:4200` })
    expect(router.sandboxProfileDescriptors).toEqual([])
  })

  it(`rejects duplicate profile names`, () => {
    expect(() =>
      createRuntimeRouter({
        baseUrl: `http://localhost:4200`,
        sandboxProfiles: [
          localProfile,
          { ...localProfile, label: `Other Local` },
        ],
      })
    ).toThrowError(/duplicate sandbox profile name "local"/)
  })

  it(`omits factory closures from the exposed descriptors`, () => {
    const router = createRuntimeRouter({
      baseUrl: `http://localhost:4200`,
      sandboxProfiles: [localProfile],
    })
    for (const desc of router.sandboxProfileDescriptors) {
      expect(`factory` in desc).toBe(false)
    }
  })
})
