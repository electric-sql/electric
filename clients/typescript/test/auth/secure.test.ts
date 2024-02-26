import test from 'ava'

import { secureAuthToken } from '../../src/auth/secure'
import { JwtPayload, jwtDecode } from '../../src/auth/decode'

test('secureAuthToken generates expected JWT token', async (t) => {
  const token = await secureAuthToken({
    claims: { sub: 'test-user' },
    iss: 'test-issuer',
    key: 'test-key',
  })

  t.is(typeof token, 'string')
  t.regex(token, /^eyJh[\w-.]+$/)
  const decodedToken = jwtDecode(token) as JwtPayload & { type: string }
  t.is(decodedToken.sub, 'test-user')
  t.is(decodedToken.iss, 'test-issuer')
  t.is(decodedToken.type, 'access')
})
