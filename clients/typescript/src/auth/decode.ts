import { base64 } from '../util/common'

export interface JwtPayload {
  iss?: string
  sub?: string
  // user_id for backwards compatibility
  user_id?: string
  aud?: string[] | string
  exp?: number
  nbf?: number
  iat?: number
  jti?: string
}

export class InvalidTokenError extends Error {}

/**
 * Decodes a JWT token into a JWT payload.
 * Adapted from: https://github.com/auth0/jwt-decode
 *
 * @param token the JWT token to decode
 * @returns the decoded payload
 */
export function jwtDecode(token: string): JwtPayload {
  const pos = 1
  const part = token.split('.')[pos]

  if (typeof part !== 'string') {
    throw new InvalidTokenError(
      `Invalid token specified: missing part #${pos + 1}`
    )
  }

  let decoded: string
  try {
    decoded = base64.decode(part)
  } catch (e) {
    throw new InvalidTokenError(
      `Invalid token specified: invalid base64 for part #${pos + 1} (${
        (e as Error).message
      })`
    )
  }

  try {
    return JSON.parse(decoded) as JwtPayload
  } catch (e) {
    throw new InvalidTokenError(
      `Invalid token specified: invalid json for part #${pos + 1} (${
        (e as Error).message
      })`
    )
  }
}
