import { serverFetch } from '@electric-ax/agents-server-ui/src/lib/auth-fetch'
import { entityApiUrl } from '@electric-ax/agents-server-ui/src/lib/entity-api'
import {
  SHARE_PERMISSIONS,
  SHARE_ROLE_PERMISSIONS,
  roleFromGrants,
  rolePermissionsMatchGrants,
} from '@electric-ax/agents-server-ui/src/lib/sharePermissions'
import { userIdFromPrincipal } from '@electric-ax/agents-server-ui/src/lib/principals'
import type {
  SharePermission,
  ShareRole,
} from '@electric-ax/agents-server-ui/src/lib/sharePermissions'

export type EntityPermissionGrant = {
  id: number
  entity_url: string
  permission: SharePermission | string
  subject_kind: `principal` | `principal_kind` | string
  subject_value: string
  created_at: string
  updated_at: string
}

export type ShareSubject = {
  kind: `principal` | `principal_kind`
  value: string
}

export const ALL_USERS_SUBJECT: ShareSubject = {
  kind: `principal_kind`,
  value: `user`,
}

export type ShareAccessEntry = {
  role: ShareRole
  grants: Array<EntityPermissionGrant>
}

export type ShareAccessModel = {
  allUsers: ShareAccessEntry | null
  users: Array<ShareAccessEntry & { userId: string }>
  /** All per-user grants, including ones that map to no role — diff
   * against these when (re-)granting so partial sets aren't duplicated. */
  grantsByUserId: Map<string, Array<EntityPermissionGrant>>
}

export class GrantsRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = `GrantsRequestError`
    this.status = status
  }
}

export async function listEntityGrants({
  baseUrl,
  entityUrl,
}: {
  baseUrl: string
  entityUrl: string
}): Promise<Array<EntityPermissionGrant>> {
  const res = await serverFetch(entityApiUrl(baseUrl, entityUrl, `/grants`))
  await assertOk(res, `Load grants`)
  const data = (await res.json()) as {
    grants?: Array<EntityPermissionGrant>
  }
  return Array.isArray(data.grants) ? data.grants : []
}

export async function createEntityGrant({
  baseUrl,
  entityUrl,
  subject,
  permission,
}: {
  baseUrl: string
  entityUrl: string
  subject: ShareSubject
  permission: SharePermission
}): Promise<void> {
  const res = await serverFetch(entityApiUrl(baseUrl, entityUrl, `/grants`), {
    method: `POST`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify({
      subject_kind: subject.kind,
      subject_value: subject.value,
      permission,
    }),
  })
  await assertOk(res, `Create grant`)
}

export async function deleteEntityGrant({
  baseUrl,
  entityUrl,
  grantId,
}: {
  baseUrl: string
  entityUrl: string
  grantId: number
}): Promise<void> {
  const res = await serverFetch(
    entityApiUrl(baseUrl, entityUrl, `/grants/${grantId}`),
    { method: `DELETE` }
  )
  await assertOk(res, `Delete grant`)
}

export function diffGrantsForRole(
  existingGrants: ReadonlyArray<EntityPermissionGrant>,
  role: ShareRole
): { deleteIds: Array<number>; createPermissions: Array<SharePermission> } {
  const existing = existingGrants.filter((grant) =>
    SHARE_PERMISSIONS.has(grant.permission)
  )
  const desired = new Set<string>(SHARE_ROLE_PERMISSIONS[role])
  const existingPermissions = new Set(existing.map((grant) => grant.permission))
  return {
    deleteIds: existing
      .filter((grant) => !desired.has(grant.permission))
      .map((grant) => grant.id),
    createPermissions: SHARE_ROLE_PERMISSIONS[role].filter(
      (permission) => !existingPermissions.has(permission)
    ),
  }
}

export function grantIdsForRemoval(
  existingGrants: ReadonlyArray<EntityPermissionGrant>
): Array<number> {
  return existingGrants
    .filter((grant) => SHARE_PERMISSIONS.has(grant.permission))
    .map((grant) => grant.id)
}

export function buildShareAccessModel(
  grants: ReadonlyArray<EntityPermissionGrant>,
  currentUserId: string | null
): ShareAccessModel {
  const allUsersGrants: Array<EntityPermissionGrant> = []
  const grantsByUserId = new Map<string, Array<EntityPermissionGrant>>()
  for (const grant of grants) {
    if (isAllUsersGrant(grant)) {
      allUsersGrants.push(grant)
      continue
    }
    if (grant.subject_kind !== `principal`) continue
    const userId = userIdFromPrincipal(grant.subject_value)
    if (!userId || userId === currentUserId) continue
    const existing = grantsByUserId.get(userId)
    if (existing) existing.push(grant)
    else grantsByUserId.set(userId, [grant])
  }

  const allUsersRole = roleFromGrants(allUsersGrants)
  const users: ShareAccessModel[`users`] = []
  for (const [userId, userGrants] of grantsByUserId) {
    const role = roleFromGrants(userGrants)
    if (role) users.push({ userId, role, grants: userGrants })
  }

  return {
    allUsers: allUsersRole
      ? { role: allUsersRole, grants: allUsersGrants }
      : null,
    users,
    grantsByUserId,
  }
}

export async function setSubjectRole({
  baseUrl,
  entityUrl,
  subject,
  role,
  existingGrants,
}: {
  baseUrl: string
  entityUrl: string
  subject: ShareSubject
  role: ShareRole
  existingGrants: ReadonlyArray<EntityPermissionGrant>
}): Promise<void> {
  if (rolePermissionsMatchGrants(role, existingGrants)) return
  const { deleteIds, createPermissions } = diffGrantsForRole(
    existingGrants,
    role
  )
  await Promise.all([
    ...deleteIds.map((grantId) =>
      deleteEntityGrant({ baseUrl, entityUrl, grantId })
    ),
    ...createPermissions.map((permission) =>
      createEntityGrant({ baseUrl, entityUrl, subject, permission })
    ),
  ])
}

export async function removeSubjectAccess({
  baseUrl,
  entityUrl,
  existingGrants,
}: {
  baseUrl: string
  entityUrl: string
  existingGrants: ReadonlyArray<EntityPermissionGrant>
}): Promise<void> {
  await Promise.all(
    grantIdsForRemoval(existingGrants).map((grantId) =>
      deleteEntityGrant({ baseUrl, entityUrl, grantId })
    )
  )
}

function isAllUsersGrant(grant: EntityPermissionGrant): boolean {
  return (
    grant.subject_kind === ALL_USERS_SUBJECT.kind &&
    grant.subject_value === ALL_USERS_SUBJECT.value
  )
}

async function assertOk(res: Response, action: string): Promise<void> {
  if (res.ok) return
  const text = await res.text().catch(() => ``)
  throw new GrantsRequestError(
    parseErrorResponse(text) ?? `${action} failed (${res.status})`,
    res.status
  )
}

function parseErrorResponse(text: string): string | null {
  if (!text) return null
  try {
    const data = JSON.parse(text) as {
      error?: { message?: unknown }
      message?: unknown
    }
    if (typeof data.error?.message === `string`) return data.error.message
    if (typeof data.message === `string`) return data.message
  } catch {
    return text
  }
  return text
}
