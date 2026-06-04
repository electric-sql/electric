export type SharePermission = `read` | `write` | `fork` | `manage`
export type ShareRole = `view` | `chat` | `manage`

export type SharePermissionGrantLike = {
  permission: string
}

export const SHARE_PERMISSIONS = new Set<string>([
  `read`,
  `write`,
  `fork`,
  `manage`,
])

export const SHARE_ROLE_PERMISSIONS = {
  view: [`read`, `fork`],
  chat: [`read`, `write`, `fork`],
  manage: [`manage`],
} as const satisfies Record<ShareRole, ReadonlyArray<SharePermission>>

export function roleFromGrants(
  grants: ReadonlyArray<SharePermissionGrantLike>
): ShareRole | null {
  const permissions = sharePermissionsFromGrants(grants)
  if (permissions.has(`manage`)) return `manage`
  if (permissions.has(`write`)) return `chat`
  if (permissions.has(`read`)) return `view`
  return null
}

export function rolePermissionsMatchGrants(
  role: ShareRole,
  grants: ReadonlyArray<SharePermissionGrantLike>
): boolean {
  const expected = new Set<string>(SHARE_ROLE_PERMISSIONS[role])
  const actual = sharePermissionsFromGrants(grants)
  if (actual.size !== expected.size) return false
  for (const permission of expected) {
    if (!actual.has(permission)) return false
  }
  return true
}

function sharePermissionsFromGrants(
  grants: ReadonlyArray<SharePermissionGrantLike>
): Set<string> {
  return new Set(
    grants
      .filter((grant) => SHARE_PERMISSIONS.has(grant.permission))
      .map((grant) => grant.permission)
  )
}
