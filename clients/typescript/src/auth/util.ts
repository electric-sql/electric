import jwt from 'jsonwebtoken'

export function authToken(iss?: string, key?: string) {
  const mockIss = iss ?? 'dev.electric-sql.com'
  const mockKey = key ?? 'integration-tests-signing-key-example'

  const iat = Math.floor(Date.now() / 1000) - 1000

  return jwt.sign({ user_id: 'test-user', type: 'access', iat }, mockKey, {
    issuer: mockIss,
    algorithm: 'HS256',
    expiresIn: '2h',
  })
}
