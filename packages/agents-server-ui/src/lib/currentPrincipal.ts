import { principalUrlFromKey, userPrincipalUrl } from './principals'

export const UNAUTHENTICATED_CLOUD_PRINCIPAL = principalUrlFromKey(
  `system:unauthenticated`
)

export function resolveCurrentPrincipal({
  activeServerIsCloud,
  cloudUserId,
  configuredPrincipal,
  fallbackPrincipal,
}: {
  activeServerIsCloud: boolean
  cloudUserId: string | null
  configuredPrincipal: string | null
  fallbackPrincipal: string
}): string {
  if (activeServerIsCloud) {
    return cloudUserId
      ? userPrincipalUrl(cloudUserId)
      : UNAUTHENTICATED_CLOUD_PRINCIPAL
  }

  return configuredPrincipal ?? fallbackPrincipal
}
