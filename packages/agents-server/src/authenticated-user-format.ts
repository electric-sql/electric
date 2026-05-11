import type { AuthenticatedRequestUser } from './electric-agents-types'

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function formatAuthenticatedUser(
  user: AuthenticatedRequestUser | null | undefined
): string | undefined {
  if (!user) return undefined
  const email = clean(user.email)
  const name = clean(user.name)
  const userId = clean(user.userId)
  if (name && email) return `${name} <${email}>`
  return email ?? name ?? userId
}
