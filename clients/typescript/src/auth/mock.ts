import { secureAuthToken } from './util'

export function mockSecureAuthToken(
  iss?: string,
  key?: string
): Promise<string> {
  const mockIss = iss ?? 'dev.electric-sql.com'
  const mockKey = key ?? 'integration-tests-signing-key-example'

  return secureAuthToken({ user_id: 'test-user' }, mockIss, mockKey)
}
