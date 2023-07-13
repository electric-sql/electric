import { SignJWT } from 'jose'

export function authToken(iss?: string, key?: string): Promise<string> {
  const mockIss = iss ?? 'dev.electric-sql.com'
  const mockKey = key ?? 'integration-tests-signing-key-example'

  const iat = Math.floor(Date.now() / 1000) - 1000

  return new SignJWT({ user_id: 'test-user', type: 'access' })
    .setIssuedAt(iat)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('2h')
    .setIssuer(mockIss)
    .sign(new TextEncoder().encode(mockKey))
}
