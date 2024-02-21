import { SignJWT, decodeJwt, JWTPayload } from 'jose'

import { TokenClaims } from '../index'
import { InvalidArgumentError } from '../../client/validation/errors/invalidArgumentError'

export function secureAuthToken(
  claims: TokenClaims,
  iss: string,
  key: string,
  alg?: string,
  exp?: string
): Promise<string> {
  const algorithm = alg ?? 'HS256'
  const expiration = exp ?? '2h'
  const iat = Math.floor(Date.now() / 1000)

  const encodedKey = new TextEncoder().encode(key)

  return new SignJWT({ ...claims, type: 'access' })
    .setIssuedAt(iat)
    .setProtectedHeader({ alg: algorithm })
    .setExpirationTime(expiration)
    .setIssuer(iss)
    .sign(encodedKey)
}

export function mockSecureAuthToken(
  iss?: string,
  key?: string
): Promise<string> {
  const mockIss = iss ?? 'dev.electric-sql.com'
  const mockKey = key ?? 'integration-tests-signing-key-example'

  return secureAuthToken({ sub: 'test-user' }, mockIss, mockKey)
}

export function decodeToken(token: string): JWTPayload & { sub: string } {
  const decoded = decodeJwt(token)
  if (typeof decoded.sub === 'undefined') {
    throw new InvalidArgumentError('Token does not contain a sub claim')
  }
  return decoded as JWTPayload & { sub: string }
}
