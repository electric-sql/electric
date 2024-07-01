import { jwtDecode, JwtPayload } from '../decode'
import { textEncoder } from '../../util/encoders'
import { TokenClaims } from '../index'
import { InvalidArgumentError } from '../../client/validation/errors/invalidArgumentError'

export async function secureAuthToken(opts: {
  claims: TokenClaims
  iss: string
  key: string
  alg?: string
  exp?: string
}): Promise<string> {
  const { SignJWT } = await import('jose')
  const algorithm = opts.alg ?? 'HS256'
  const expiration = opts.exp ?? '2h'
  const iat = Math.floor(Date.now() / 1000)

  const encodedKey = textEncoder.encode(opts.key)

  return new SignJWT({ ...opts.claims, type: 'access' })
    .setIssuedAt(iat)
    .setProtectedHeader({ alg: algorithm })
    .setExpirationTime(expiration)
    .setIssuer(opts.iss)
    .sign(encodedKey)
}

export function mockSecureAuthToken(
  exp?: string,
  iss?: string,
  key?: string
): Promise<string> {
  const mockIss = iss ?? 'dev.electric-sql.com'
  const mockKey = key ?? 'integration-tests-signing-key-example'

  return secureAuthToken({
    claims: { sub: 'test-user' },
    iss: mockIss,
    key: mockKey,
    exp,
  })
}

export function decodeToken(
  token: string
): JwtPayload & ({ sub: string } | { user_id: string }) {
  const decoded = jwtDecode(token)
  if (
    typeof decoded.sub === 'undefined' &&
    typeof decoded.user_id === 'undefined'
  ) {
    throw new InvalidArgumentError(
      'Token does not contain a sub or user_id claim'
    )
  }

  return decoded as JwtPayload & ({ sub: string } | { user_id: string })
}

/**
 * Retrieves the user ID encoded in the JWT token
 * @param token the encoded JWT token
 * @returns {Uuid} the user ID found in the `sub` or `user_id` claim
 */
export function decodeUserIdFromToken(token: string): string {
  const decoded = decodeToken(token)

  // `sub` is the standard claim, but `user_id` is also used in the Electric service
  // We first check for sub, and if it's not present, we use user_id
  return (decoded.sub ?? decoded.user_id) as string
}
