import { describe, expect, it } from 'vitest'
import {
  SHARE_ROLE_PERMISSIONS,
  roleFromGrants,
  rolePermissionsMatchGrants,
} from './sharePermissions'

describe(`share permissions`, () => {
  it(`expands share roles to the permissions the UI delegates`, () => {
    expect(SHARE_ROLE_PERMISSIONS.view).toEqual([`read`, `fork`])
    expect(SHARE_ROLE_PERMISSIONS.chat).toEqual([
      `read`,
      `write`,
      `signal`,
      `fork`,
      `schedule`,
      `spawn`,
    ])
    expect(SHARE_ROLE_PERMISSIONS.manage).toEqual([`manage`, `delete`])
  })

  it(`keeps older read-only grants visible as view but not fully up to date`, () => {
    const grants = [{ permission: `read` }]

    expect(roleFromGrants(grants)).toBe(`view`)
    expect(rolePermissionsMatchGrants(`view`, grants)).toBe(false)
  })

  it(`matches a role only when its share permissions match exactly`, () => {
    expect(
      rolePermissionsMatchGrants(`view`, [
        { permission: `read` },
        { permission: `fork` },
      ])
    ).toBe(true)
    expect(
      rolePermissionsMatchGrants(`chat`, [
        { permission: `read` },
        { permission: `write` },
        { permission: `signal` },
        { permission: `fork` },
        { permission: `schedule` },
        { permission: `spawn` },
      ])
    ).toBe(true)
    expect(
      rolePermissionsMatchGrants(`manage`, [
        { permission: `manage` },
        { permission: `delete` },
      ])
    ).toBe(true)
  })
})
