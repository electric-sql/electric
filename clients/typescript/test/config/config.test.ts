import test from 'ava'
import { hydrateConfig } from '../../src/config'

test('hydrateConfig adds expected defaults', (t) => {
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

test('hydrageConfig custom config', (t) => {
  const hydrated = hydrateConfig({
    auth: {
      token: 'test-token-2',
    },
    url: 'https://192.169.2.10',
    debug: true,
  })

  t.is(hydrated.replication.host, '192.169.2.10')
  t.is(hydrated.replication.port, 443)
  t.is(hydrated.replication.ssl, true)

  t.is(hydrated.auth.token, 'test-token-2')
  t.is(hydrated.debug, true)
})

test('hydrateConfig port inference', (t) => {
  const expectations: Record<string, { port: number; ssl: boolean }> = {
    http: {
      port: 80,
      ssl: false,
    },
    https: {
      port: 443,
      ssl: true,
    },
    electric: {
      port: 80,
      ssl: false,
    },
    ws: {
      port: 80,
      ssl: false,
    },
    wss: {
      port: 443,
      ssl: true,
    },
  }

  Object.entries(expectations).forEach(([protocol, expect]) => {
    const url = `${protocol}://1.1.1.1`
    const config = hydrateConfig({
      auth: {
        token: 'test-token',
      },
      url,
    })

    t.is(config.replication.port, expect.port)
    t.is(config.replication.ssl, expect.ssl)
  })
})

test('hydrateConfig ssl', (t) => {
  const hydrated = hydrateConfig({
    auth: {
      token: 'test-token',
    },
    url: 'http://1.1.1.1?ssl=true',
  })

  t.is(hydrated.replication.ssl, true)
})

test('hydrateConfig checks for auth token', (t) => {
  t.throws(
    () => {
      hydrateConfig({
        auth: {
          token: '',
        },
      })
    },
    {
      message: 'Invalid configuration. Missing authentication token.',
    }
  )
})

test('hydrateConfig checks for valid service url', (t) => {
  const errorReasons = {
    'postgresql://somehost.com': 'Invalid url protocol.',
    'https://user@somehost.com': 'Username and password are not supported.',
    'https://user:pass@somehost.com':
      'Username and password are not supported.',
    // No reason, but it returns an invalid url error as well
    'https://somehost.com:wrongport': '',
  }

  Object.entries(errorReasons).forEach(([url, reason]) => {
    let expectedErrorMsg = "Invalid 'url' in the configuration."
    if (reason) {
      expectedErrorMsg = expectedErrorMsg + ' ' + reason
    }

    t.throws(
      () => {
        hydrateConfig({
          auth: {
            token: 'test-token',
          },
          url,
        })
      },
      {
        message: expectedErrorMsg,
      }
    )
  })
})
