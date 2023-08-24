import test from 'ava'
import { decodeJwt } from 'jose'

import { insecureAuthToken } from '../../src/auth'

test('insecureAuthToken generates expected token', async (t) => {
  const token = insecureAuthToken({ user_id: 'dummy-user' })

  const claims = decodeJwt(token)
  t.deepEqual(claims, { user_id: 'dummy-user' })
})

test('insecureAuthToken supports non-latin characters', async (t) => {
  const token = insecureAuthToken({ user_id: '⚡' })

  const claims = decodeJwt(token)
  t.deepEqual(claims, { user_id: '⚡' })
})
