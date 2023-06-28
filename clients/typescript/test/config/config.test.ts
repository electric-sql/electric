import test from 'ava'
import { hydrateConfig } from '../../src/config'

test('hydrateConfig adds expected defaults', async (t) => {
  const hydrated = hydrateConfig({
    auth: {
      token: 'test-token',
    },
  })

  t.is(hydrated.replication.host, '127.0.0.1')
  t.is(hydrated.replication.port, 5133)
  t.is(hydrated.replication.ssl, false)

  t.is(hydrated.auth.token, 'test-token')

  t.false(hydrated.debug)
})
