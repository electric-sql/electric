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

export async function getDesktopFormattedAssertedIdentity(): Promise<
  string | undefined
> {
  const headers = await getDesktopAssertedAuthHeaders()
  return formatAssertedIdentity({
    email: headers[DEV_ASSERTED_EMAIL_HEADER],
    name: headers[DEV_ASSERTED_NAME_HEADER],
    userId:
      headers[DEV_ASSERTED_EMAIL_HEADER] ?? headers[DEV_ASSERTED_NAME_HEADER],
  })
}
