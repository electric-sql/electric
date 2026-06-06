import { describe, expect, it } from 'vitest'
import {
  getEntityRunnerId,
  getEntitySandboxProfileName,
  resolveEffectiveSandbox,
  runnerDisplayLabel,
} from './entityRuntime'
import type { ElectricEntity, ElectricRunner } from './ElectricAgentsProvider'

function runner(
  id: string,
  label: string,
  profiles: ElectricRunner[`sandbox_profiles`] = []
): ElectricRunner {
  return {
    id,
    label,
    kind: `local`,
    admin_status: `enabled`,
    sandbox_profiles: profiles,
  } as unknown as ElectricRunner
}

function entity(over: Partial<ElectricEntity>): ElectricEntity {
  return {
    url: `/horton/x`,
    type: `horton`,
    status: `idle`,
    tags: {},
    spawn_args: {},
    parent: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  } as unknown as ElectricEntity
}

const RUNNER_TARGET = {
  dispatch_policy: { targets: [{ type: `runner`, runnerId: `r1` }] },
}

describe(`getEntityRunnerId`, () => {
  it(`reads the runner target id`, () => {
    expect(getEntityRunnerId(entity(RUNNER_TARGET))).toBe(`r1`)
  })
  it(`returns null with no dispatch policy`, () => {
    expect(getEntityRunnerId(entity({ dispatch_policy: null }))).toBeNull()
  })
  it(`returns null for a non-runner (webhook) target`, () => {
    expect(
      getEntityRunnerId(
        entity({
          dispatch_policy: {
            targets: [{ type: `webhook`, url: `https://x` }],
          },
        } as Partial<ElectricEntity>)
      )
    ).toBeNull()
  })
})

describe(`getEntitySandboxProfileName`, () => {
  it(`returns the explicit profile`, () => {
    expect(
      getEntitySandboxProfileName(entity({ sandbox: { profile: `docker` } }))
    ).toBe(`docker`)
  })
  it(`returns null when no sandbox is recorded`, () => {
    expect(getEntitySandboxProfileName(entity({ sandbox: null }))).toBeNull()
  })
})

describe(`resolveEffectiveSandbox`, () => {
  const docker = { name: `docker`, label: `Docker`, description: `Hardened` }
  const local = {
    name: `local`,
    label: `Local`,
    description: `Runs on the host`,
  }
  const e2b = { name: `e2b`, label: `E2B`, remote: true }
  const r = runner(`r1`, `Desktop`, [local, docker, e2b])

  it(`resolves an explicit profile against the runner advertisement`, () => {
    const sb = resolveEffectiveSandbox(
      [r],
      entity({ sandbox: { profile: `docker` } }),
      r
    )
    expect(sb).toMatchObject({
      name: `docker`,
      label: `Docker`,
      description: `Hardened`,
      remote: false,
      isDefault: false,
    })
  })

  it(`marks a remote profile as remote`, () => {
    const sb = resolveEffectiveSandbox(
      [r],
      entity({ sandbox: { profile: `e2b` } }),
      r
    )
    expect(sb).toMatchObject({ name: `e2b`, label: `E2B`, remote: true })
  })

  it(`falls back to the advertised Local profile when none chosen`, () => {
    const sb = resolveEffectiveSandbox([r], entity({ sandbox: null }), r)
    expect(sb).toMatchObject({
      name: `local`,
      label: `Local`,
      isDefault: true,
      remote: false,
    })
  })

  it(`synthesizes a Local default when the runner advertises no local profile`, () => {
    const bare = runner(`r2`, `Bare`, [])
    const sb = resolveEffectiveSandbox([bare], entity({ sandbox: null }), bare)
    expect(sb).toMatchObject({ name: `local`, label: `Local`, isDefault: true })
    expect(sb.description).toMatch(/default/i)
  })

  it(`uses the profile name as label when it isn't advertised`, () => {
    const sb = resolveEffectiveSandbox(
      [],
      entity({ sandbox: { profile: `mystery` } }),
      null
    )
    expect(sb).toMatchObject({
      name: `mystery`,
      label: `mystery`,
      isDefault: false,
    })
  })
})

describe(`runnerDisplayLabel`, () => {
  it(`prefers the runner label`, () => {
    expect(runnerDisplayLabel(runner(`r1`, `Desktop`), `r1`)).toBe(`Desktop`)
  })
  it(`shortens a bare id when no runner is resolved`, () => {
    expect(runnerDisplayLabel(null, `abcdefghijklmnop`)).toBe(`abcdefgh…`)
  })
  it(`falls back to a generic label with neither`, () => {
    expect(runnerDisplayLabel(null, null)).toBe(`Unknown runner`)
  })
})
