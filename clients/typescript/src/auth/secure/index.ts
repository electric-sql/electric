import { SignJWT } from 'jose'

import { TokenClaims } from '../index.js'

export function secureAuthToken(
  claims: TokenClaims,
  iss: string,
  key: string,
  alg?: string,
  exp?: string
): Promise<string> {
  const algorithm = alg ?? 'HS256'
  const expiration = exp ?? '2h'

  const nowInSecs = Math.floor(Date.now() / 1000)
  // Subtract 1 second to account for clock precision when validating the token
  const iat = nowInSecs - 1

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

  return secureAuthToken({ user_id: 'test-user' }, mockIss, mockKey)
}
