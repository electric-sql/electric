import test from 'ava'
import { hydrateConfig } from '../../src/config'

test('hydrateConfig adds expected defaults', async (t) => {
  const hydrated = hydrateConfig({
    auth: {
      token: 'test-token',
    },
  })

  t.is(hydrated.replication.host, 'localhost')
  t.is(hydrated.replication.port, 5133)
  t.is(hydrated.replication.ssl, false)
  t.is(hydrated.replication.timeout, 3000)

  t.is(hydrated.auth.token, 'test-token')

  t.false(hydrated.debug)
})
