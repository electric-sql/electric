import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { useCurrentPrincipal } from './useCurrentPrincipal'
import { normalizePrincipalUrl, principalKeyFromInput } from '../lib/principals'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

export type EntityPermission =
  | `read`
  | `write`
  | `delete`
  | `signal`
  | `fork`
  | `schedule`
  | `spawn`
  | `manage`

const BUILT_IN_SYSTEM_PRINCIPAL_IDS = new Set([
  `framework`,
  `auth-sync`,
  `dev-local`,
])

export function useEntityPermission(
  entity: ElectricEntity | null | undefined,
  permission: EntityPermission
): boolean {
  const { entityEffectivePermissionsCollection } = useElectricAgents()
  const { principal } = useCurrentPrincipal()
  const { data: grants = [] } = useLiveQuery(
    (query) => {
      if (!entityEffectivePermissionsCollection || !entity) return undefined
      return query
        .from({ grant: entityEffectivePermissionsCollection })
        .where(({ grant }) => eq(grant.entity_url, entity.url))
    },
    [entityEffectivePermissionsCollection, entity?.url]
  )

  return useMemo(() => {
    if (!entity) return false
    if (isBuiltInSystemPrincipal(principal)) return true
    if (isEntityCreator(entity, principal)) return true

    const permissions = new Set(grants.map((grant) => grant.permission))
    return permissions.has(permission) || permissions.has(`manage`)
  }, [entity, grants, permission, principal])
}

export function useEntityPermissions(
  entity: ElectricEntity | null | undefined,
  permissions: ReadonlyArray<EntityPermission>
): Record<EntityPermission, boolean> {
  const { entityEffectivePermissionsCollection } = useElectricAgents()
  const { principal } = useCurrentPrincipal()
  const { data: grants = [] } = useLiveQuery(
    (query) => {
      if (!entityEffectivePermissionsCollection || !entity) return undefined
      return query
        .from({ grant: entityEffectivePermissionsCollection })
        .where(({ grant }) => eq(grant.entity_url, entity.url))
    },
    [entityEffectivePermissionsCollection, entity?.url]
  )

  return useMemo(() => {
    const out: Record<EntityPermission, boolean> = {
      read: false,
      write: false,
      delete: false,
      signal: false,
      fork: false,
      schedule: false,
      spawn: false,
      manage: false,
    }

    if (!entity) return out
    if (
      isBuiltInSystemPrincipal(principal) ||
      isEntityCreator(entity, principal)
    ) {
      for (const permission of permissions) out[permission] = true
      return out
    }

    const granted = new Set(grants.map((grant) => grant.permission))
    const hasManage = granted.has(`manage`)
    for (const permission of permissions) {
      out[permission] = hasManage || granted.has(permission)
    }
    return out
  }, [entity, grants, permissions, principal])
}

function isEntityCreator(entity: ElectricEntity, principal: string): boolean {
  const creatorUrl = normalizePrincipalUrl(entity.created_by)
  const principalUrl = normalizePrincipalUrl(principal)
  return (
    creatorUrl !== null && principalUrl !== null && creatorUrl === principalUrl
  )
}

function isBuiltInSystemPrincipal(principal: string): boolean {
  const key = principalKeyFromInput(principal)
  if (!key?.startsWith(`system:`)) return false
  return BUILT_IN_SYSTEM_PRINCIPAL_IDS.has(key.slice(`system:`.length))
}
