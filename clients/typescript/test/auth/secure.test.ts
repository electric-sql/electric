import test from 'ava'

import { secureAuthToken } from '../../src/auth/secure'
import { jwtDecode } from '../../src/auth/decode'

const originalDateNow = Date.now

test.afterEach(() => {
  Date.now = originalDateNow
})

test('secureAuthToken generates expected JWT token', async (t) => {
  const mockDate = new Date()
  Date.now = () => mockDate.getTime()

  const token = await secureAuthToken({
    claims: { sub: 'test-user' },
    iss: 'test-issuer',
    key: 'test-key',
    exp: '2h',
  })

  const expectedIat = Math.floor(mockDate.getTime() / 1000)
  const expectedExp = expectedIat + 2 * 60 * 60

  t.is(typeof token, 'string')
  t.regex(token, /^eyJh[\w-.]+$/)
  t.deepEqual(jwtDecode(token), {
    iat: expectedIat,
    exp: expectedExp,
    sub: 'test-user',
    type: 'access',
    iss: 'test-issuer',
  })
})
