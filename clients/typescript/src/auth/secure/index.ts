import { SignJWT, decodeJwt, JWTPayload } from 'jose'

import { TokenClaims } from '../index'
import { InvalidArgumentError } from '../../client/validation/errors/invalidArgumentError'

export function secureAuthToken(opts: {
  claims: TokenClaims
  iss: string
  key: string
  alg?: string
  exp?: string
}): Promise<string> {
  const algorithm = opts.alg ?? 'HS256'
  const expiration = opts.exp ?? '2h'
  const iat = Math.floor(Date.now() / 1000)

  const encodedKey = new TextEncoder().encode(opts.key)

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

export function decodeToken(token: string): JWTPayload & { sub: string } {
  const decoded = decodeJwt(token)
  if (typeof decoded.sub === 'undefined') {
    throw new InvalidArgumentError('Token does not contain a sub claim')
  }
  return decoded as JWTPayload & { sub: string }
}
