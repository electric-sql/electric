import type { ElectricUser } from './ElectricAgentsProvider'

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

export function normalizePrincipalUrl(
  value: string | null | undefined
): string | null {
  const key = principalKeyFromInput(value)
  return key ? principalUrlFromKey(key) : null
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

/**
 * Display label for a message/comment sender principal: "Me" for the current
 * principal, the user's display name when known, otherwise `kind:id` with a
 * truncated id. `title` always carries the full principal key for tooltips.
 */
export function formatSender(
  from: string | null | undefined,
  options: {
    currentPrincipal?: string
    usersById?: Map<string, ElectricUser>
  } = {}
): {
  label: string
  title?: string
} {
  const key = principalKeyFromInput(from)
  if (!key) return { label: from || `user` }
  if (key === principalKeyFromInput(options.currentPrincipal)) {
    return { label: `Me`, title: key }
  }
  const colon = key.indexOf(`:`)
  if (colon <= 0) return { label: key, title: key }
  const kind = key.slice(0, colon)
  const id = key.slice(colon + 1)
  if (kind === `user`) {
    const user = options.usersById?.get(id)
    const label = userDisplayName(user)
    if (label) return { label, title: key }
  }
  return {
    label: `${kind}:${formatPrincipalId(id)}`,
    title: key,
  }
}

export function userDisplayName(user: ElectricUser | undefined): string | null {
  if (!user) return null
  return user.display_name || user.email || null
}

function formatPrincipalId(id: string): string {
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}…${id.slice(-6)}`
}
