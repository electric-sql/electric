import { getDesktopAssertedAuthHeaders } from './auth-fetch'

const DEV_ASSERTED_EMAIL_HEADER = `x-electric-asserted-email`
const DEV_ASSERTED_NAME_HEADER = `x-electric-asserted-name`

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export type AssertedIdentity = {
  userId?: string
  email?: string
  name?: string
}

export function formatAssertedIdentity(
  identity: AssertedIdentity | null | undefined
): string | undefined {
  if (!identity) return undefined
  const email = clean(identity.email)
  const name = clean(identity.name)
  const userId = clean(identity.userId)
  if (name && email) return `${name} <${email}>`
  return email ?? name ?? userId
}

let cachedDesktopAssertedIdentity: string | undefined
let preloadPromise: Promise<string | undefined> | null = null

export function getCachedDesktopFormattedAssertedIdentity():
  | string
  | undefined {
  return cachedDesktopAssertedIdentity
}

export async function preloadDesktopFormattedAssertedIdentity(): Promise<
  string | undefined
> {
  if (cachedDesktopAssertedIdentity) return cachedDesktopAssertedIdentity
  preloadPromise ??= getDesktopAssertedAuthHeaders().then((headers) => {
    cachedDesktopAssertedIdentity = formatAssertedIdentity({
      email: headers[DEV_ASSERTED_EMAIL_HEADER],
      name: headers[DEV_ASSERTED_NAME_HEADER],
      userId:
        headers[DEV_ASSERTED_EMAIL_HEADER] ?? headers[DEV_ASSERTED_NAME_HEADER],
    })
    if (!cachedDesktopAssertedIdentity) preloadPromise = null
    return cachedDesktopAssertedIdentity
  })
  return preloadPromise
}

export async function getDesktopFormattedAssertedIdentity(): Promise<
  string | undefined
> {
  return preloadDesktopFormattedAssertedIdentity()
}

export function __resetAssertedIdentityCacheForTests(): void {
  cachedDesktopAssertedIdentity = undefined
  preloadPromise = null
}
