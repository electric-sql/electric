import type { IncomingMessage } from 'node:http'
import type {
  AuthenticateRequest,
  AuthenticatedRequestUser,
} from './electric-agents-types.js'

export interface DevAssertedAuthOptions {
  enabled?: boolean
  defaultEmail?: string
  defaultName?: string
}

export const DEV_ASSERTED_EMAIL_HEADER = `x-electric-asserted-email`
export const DEV_ASSERTED_NAME_HEADER = `x-electric-asserted-name`

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function readHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  if (Array.isArray(value)) return clean(value[0])
  return clean(value)
}

export function createDevAssertedAuthenticateRequest(
  options: DevAssertedAuthOptions
): AuthenticateRequest | undefined {
  if (!options.enabled) return undefined

  return (req): AuthenticatedRequestUser | null => {
    const email =
      readHeader(req, DEV_ASSERTED_EMAIL_HEADER) ?? clean(options.defaultEmail)
    const name =
      readHeader(req, DEV_ASSERTED_NAME_HEADER) ?? clean(options.defaultName)
    const userId = email ?? name
    if (!userId) return null
    return { userId, email, name }
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
