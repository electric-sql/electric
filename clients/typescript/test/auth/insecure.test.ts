import test from 'ava'
import { decodeJwt } from 'jose'

import { insecureAuthToken } from '../../src/auth'

test('insecureAuthToken generates expected token', async (t) => {
  const token = insecureAuthToken({ sub: 'dummy-user' })

  const claims = decodeJwt(token)
  t.deepEqual(claims, { sub: 'dummy-user' })
})

test('insecureAuthToken supports non-latin characters', async (t) => {
  const token = insecureAuthToken({ sub: '⚡' })

  const claims = decodeJwt(token)
  t.deepEqual(claims, { sub: '⚡' })
})
