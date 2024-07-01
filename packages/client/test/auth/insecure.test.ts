import test from 'ava'
import { jwtDecode } from '../../src/auth/decode'

import { insecureAuthToken } from '../../src/auth'

test('insecureAuthToken generates expected token', async (t) => {
  const token = insecureAuthToken({ sub: 'dummy-user' })

  const claims = jwtDecode(token)
  t.deepEqual(claims, { sub: 'dummy-user' })
})

test('insecureAuthToken supports non-latin characters', async (t) => {
  const token = insecureAuthToken({ sub: '⚡' })

  const claims = jwtDecode(token)
  t.deepEqual(claims, { sub: '⚡' })
})
