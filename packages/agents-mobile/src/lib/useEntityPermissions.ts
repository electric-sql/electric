import { useMemo } from 'react'
import { eq, useLiveQuery } from '@tanstack/react-db'
import {
  normalizePrincipalUrl,
  principalKeyFromInput,
} from '@electric-ax/agents-server-ui/src/lib/principals'
import { useAgents } from './AgentsProvider'
import { useCurrentPrincipal } from './useCurrentPrincipal'
import type { ElectricEntity } from './agentsClient'

export type EntityPermission =
  | `read`
  | `write`
  | `delete`
  | `signal`
  | `fork`
  | `schedule`
  | `spawn`
  | `manage`

const ALL_ENTITY_PERMISSIONS: ReadonlyArray<EntityPermission> = [
  `read`,
  `write`,
  `delete`,
  `signal`,
  `fork`,
  `schedule`,
  `spawn`,
  `manage`,
]

const BUILT_IN_SYSTEM_PRINCIPAL_IDS = new Set([
  `framework`,
  `auth-sync`,
  `dev-local`,
])

export function useEntityPermission(
  entity: ElectricEntity | null | undefined,
  permission: EntityPermission
): boolean {
  return useEntityPermissions(entity, [permission])[permission]
}

export function useEntityPermissions(
  entity: ElectricEntity | null | undefined,
  permissions: ReadonlyArray<EntityPermission>
): Record<EntityPermission, boolean> {
  const { entityEffectivePermissionsCollection } = useAgents()
  const { principal } = useCurrentPrincipal()
  const { data: grants = [] } = useLiveQuery(
    (query) => {
      if (!entity) return undefined
      return query
        .from({ grant: entityEffectivePermissionsCollection })
        .where(({ grant }) => eq(grant.entity_url, entity.url))
    },
    [entityEffectivePermissionsCollection, entity?.url]
  )

  return useMemo(() => {
    const out = Object.fromEntries(
      ALL_ENTITY_PERMISSIONS.map((permission) => [permission, false])
    ) as Record<EntityPermission, boolean>

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
