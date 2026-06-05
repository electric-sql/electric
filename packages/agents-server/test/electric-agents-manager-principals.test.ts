import { describe, expect, it, vi } from 'vitest'
import { EntityManager } from '../src/entity-manager'
import { parsePrincipalKey } from '../src/principal'
import type { ElectricAgentsEntity } from '../src/electric-agents-types'

function createManager() {
  const registry = {
    getEntity: vi.fn(),
    ensureEntityType: vi.fn().mockResolvedValue({
      name: `principal`,
      description: `built-in principal entity`,
      revision: 1,
      created_at: `2026-06-01T00:00:00.000Z`,
      updated_at: `2026-06-01T00:00:00.000Z`,
    }),
    ensureUserForPrincipal: vi.fn().mockResolvedValue(undefined),
  }
  const streamClient = {
    append: vi.fn().mockResolvedValue({ offset: `1` }),
  }
  const manager = new EntityManager({
    registry: registry as any,
    streamClient: streamClient as any,
    validator: {} as any,
    wakeRegistry: {
      setTimeoutCallback: vi.fn(),
      setDebounceCallback: vi.fn(),
    } as any,
  })

  return { manager, registry, streamClient }
}

function principalEntity(principalKey: string): ElectricAgentsEntity & {
  txid: number
} {
  return {
    url: `/principal/${encodeURIComponent(principalKey)}`,
    type: `principal`,
    status: `idle`,
    streams: {
      main: `/principal/${encodeURIComponent(principalKey)}/main`,
    },
    subscription_id: `sub-principal`,
    write_token: `write-token`,
    tags: {},
    created_at: Date.now(),
    updated_at: Date.now(),
    txid: 1,
  }
}

describe(`ElectricAgentsManager principals`, () => {
  it(`ensures a users row when materializing a user principal`, async () => {
    const { manager, registry } = createManager()
    registry.getEntity.mockResolvedValue(null)
    const principal = parsePrincipalKey(`user:alice`)
    vi.spyOn(manager, `spawn`).mockResolvedValue(principalEntity(principal.key))

    await manager.ensurePrincipal(principal)

    expect(registry.ensureUserForPrincipal).toHaveBeenCalledWith(principal)
  })

  it(`does not create a users row for non-user principals`, async () => {
    const { manager, registry } = createManager()
    const principal = parsePrincipalKey(`service:github`)
    registry.getEntity.mockResolvedValue(principalEntity(principal.key))

    await manager.ensurePrincipal(principal)

    expect(registry.ensureUserForPrincipal).not.toHaveBeenCalled()
  })
})
