export type UserDisplayInfo = {
  display_name?: string | null
  email?: string | null
}

export type UserDisplay = {
  primary: string
  secondary: string
  initials: string
}

export function userDisplay(
  user: UserDisplayInfo | undefined,
  fallbackId: string
): UserDisplay {
  const primary = user?.display_name || user?.email || fallbackId
  const secondary =
    user?.display_name && user.email
      ? user.email
      : user?.display_name || user?.email
        ? fallbackId
        : `user:${fallbackId}`
  return {
    primary,
    secondary,
    initials: initials(primary || fallbackId),
  }
}

export function userSearchText(user: UserDisplayInfo & { id: string }): string {
  return [user.display_name, user.email, user.id].filter(Boolean).join(` `)
}

function initials(value: string): string {
  const parts = value
    .replace(/@.*/, ``)
    .split(/[\s._-]+/)
    .filter(Boolean)
  const letters =
    parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : value.slice(0, 2)
  return letters.toUpperCase()
}
