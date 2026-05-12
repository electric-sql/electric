import { parsePrincipalKey } from './principal.js'
import type { Principal } from './principal.js'

export interface DevAssertedAuthOptions {
  enabled?: boolean
  defaultEmail?: string
  defaultName?: string
}

export const DEV_ASSERTED_EMAIL_HEADER = `x-electric-asserted-email`
export const DEV_ASSERTED_NAME_HEADER = `x-electric-asserted-name`

function clean(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function createDevAssertedAuthenticateRequest(
  options: DevAssertedAuthOptions
): ((request: Request) => Principal | null) | undefined {
  if (!options.enabled) return undefined
  return (request): Principal | null => {
    const email =
      clean(request.headers.get(DEV_ASSERTED_EMAIL_HEADER)) ??
      clean(options.defaultEmail)
    const name =
      clean(request.headers.get(DEV_ASSERTED_NAME_HEADER)) ??
      clean(options.defaultName)
    const id = email ?? name
    return id ? parsePrincipalKey(`user:${id}`) : null
  }
}

export function devAssertedAuthOptionsFromEnv(
  env: Record<string, string | undefined> = process.env
): DevAssertedAuthOptions {
  return {
    enabled: env.ELECTRIC_AGENTS_DEV_ASSERTED_AUTH === `1`,
    defaultEmail: env.ELECTRIC_ASSERTED_AUTH_EMAIL,
    defaultName: env.ELECTRIC_ASSERTED_AUTH_NAME,
  }
}
