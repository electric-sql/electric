import test from 'ava'
import { hydrateConfig } from '../../src/config'
import { LoggedMsg, setupLoggerMock } from '../support/log-mock'

let log: Array<LoggedMsg> = []
setupLoggerMock(test, () => log)

const validAuth = {
  token: 'test-token',
}

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
      auth: validAuth,
      url,
    })

    t.is(config.replication.port, expect.port)
    t.is(config.replication.ssl, expect.ssl)
  })
})

test('hydrateConfig ssl', (t) => {
  const hydrated = hydrateConfig({
    auth: validAuth,
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

test('hydrateConfig throws for invalid service url', (t) => {
  const urls = ['', 'https://somehost.com:wrongport', 'abc']

  urls.forEach((url) => {
    const expectedErrorMsg = "Invalid 'url' in the configuration."

    t.throws(
      () => {
        hydrateConfig({
          auth: validAuth,
          url,
        })
      },
      {
        message: expectedErrorMsg,
      }
    )
  })
})

test('hydrateConfig warns unexpected service urls', (t) => {
  const warnReasons = {
    'postgresql://somehost.com': ['Unsupported URL protocol.'],
    'https://user@somehost.com': ['Username and password are not supported.'],
    'custom://user:pass@somehost.com': [
      'Unsupported URL protocol.',
      'Username and password are not supported.',
    ],
    'http://somehost.com:1234/some/path': ['An URL path is not supported.'],
  }

  Object.entries(warnReasons).forEach(([url, reasons]) => {
    // Cleanup logs between urls
    log = []

    let expectedWarningMsg = "Unexpected 'url' in the configuration."
    if (reasons.length > 0) {
      expectedWarningMsg += ` ${reasons.join(' ')}`
    }
    expectedWarningMsg += " An URL like 'http(s)://<host>:<port>' is expected."

    hydrateConfig({
      auth: validAuth,
      url,
    })

    t.deepEqual(log, [expectedWarningMsg])
  })
})
