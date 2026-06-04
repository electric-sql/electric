export function principalUrlFromKey(principalKey: string): string {
  const trimmed = principalKey.trim()
  return trimmed.startsWith(`/principal/`)
    ? trimmed
    : `/principal/${encodeURIComponent(trimmed)}`
}

export function principalKeyFromInput(
  value: string | null | undefined
): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith(`/principal/`)) return trimmed

  const segment = trimmed.slice(`/principal/`.length)
  if (!segment || segment.includes(`/`)) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export function userPrincipalUrl(userId: string): string {
  return principalUrlFromKey(`user:${userId}`)
}

export function userIdFromPrincipal(
  value: string | null | undefined
): string | null {
  const key = principalKeyFromInput(value)
  return key?.startsWith(`user:`) ? key.slice(`user:`.length) : null
}
