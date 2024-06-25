import test from 'ava'
import {
  extractDatabaseURL,
  extractServiceURL,
  parsePgProxyPort,
} from '../../src/util'

test('extractServiceURL decomposes electric URL', async (t) => {
  t.deepEqual(extractServiceURL('http://localhost:5133'), {
    host: 'localhost',
    port: 5133,
  })

  t.deepEqual(extractServiceURL('https://www.my-website.com'), {
    host: 'www.my-website.com',
    port: null,
  })

  t.deepEqual(extractServiceURL('https://www.my-website.com:8132'), {
    host: 'www.my-website.com',
    port: 8132,
  })
})

const postgresUrlExamples = {
  'postgresql://postgres:password@example.com:5432/app-db': {
    user: 'postgres',
    password: 'password',
    host: 'example.com',
    port: 5432,
    dbName: 'app-db',
  },
  'postgresql://electric@192.168.111.33:81/__shadow': {
    user: 'electric',
    password: '',
    host: '192.168.111.33',
    port: 81,
    dbName: '__shadow',
  },
  'postgresql://pg@[2001:db8::1234]:4321': {
    user: 'pg',
    password: '',
    host: '[2001:db8::1234]',
    port: 4321,
    dbName: 'pg',
  },
  'postgresql://user@localhost:5433/': {
    user: 'user',
    password: '',
    host: 'localhost',
    port: 5433,
    dbName: 'user',
  },
  'postgresql://user%2Btesting%40gmail.com:weird%2Fpassword@localhost:5433/my%2Bdb%2Bname':
    {
      user: 'user+testing@gmail.com',
      password: 'weird/password',
      host: 'localhost',
      port: 5433,
      dbName: 'my+db+name',
    },
  'postgres://super_user@localhost:7801/postgres': {
    user: 'super_user',
    password: '',
    host: 'localhost',
    port: 7801,
    dbName: 'postgres',
  },
}

test('extractDatabaseURL should parse valid URLs', (t) => {
  for (const [url, expected] of Object.entries(postgresUrlExamples)) {
    t.deepEqual(extractDatabaseURL(url), expected)
  }
})

test('extractDatabaseURL throws for invalid URL scheme', (t) => {
  const url = 'postgrex://localhost'
  t.throws(() => extractDatabaseURL(url), {
    instanceOf: Error,
    message: `Invalid database URL scheme: ${url}`,
  })
})

test('extractDatabaseURL throws for missing username', (t) => {
  const url1 = 'postgresql://localhost'
  t.throws(() => extractDatabaseURL(url1), {
    instanceOf: Error,
    message: `Invalid or missing username: ${url1}`,
  })

  const url2 = 'postgresql://:@localhost'
  t.throws(() => extractDatabaseURL(url2), {
    instanceOf: Error,
    message: `Invalid or missing username: ${url2}`,
  })

  const url3 = 'postgresql://:password@localhost'
  t.throws(() => extractDatabaseURL(url3), {
    instanceOf: Error,
    message: `Invalid or missing username: ${url3}`,
  })
})

test('extractDatabaseURL throws for missing host', (t) => {
  const url = 'postgresql://user:password@'
  t.throws(() => extractDatabaseURL(url), {
    instanceOf: Error,
    message: `Invalid URL`,
  })
})

test('parsePgProxyPort parses regular port number', async (t) => {
  t.deepEqual(parsePgProxyPort(5133), {
    http: false,
    port: 5133,
  })

  t.deepEqual(parsePgProxyPort('65432'), {
    http: false,
    port: 65432,
  })
})

test('parsePgProxyPort http proxy port', async (t) => {
  t.deepEqual(parsePgProxyPort('http:5133'), {
    http: true,
    port: 5133,
  })

  // @ts-expect-error invalid port prefix
  t.deepEqual(parsePgProxyPort('random:5133'), {
    http: false,
    port: 5133,
  })
})

test('parsePgProxyPort http proxy with default port', async (t) => {
  t.deepEqual(parsePgProxyPort('http'), {
    http: true,
    port: 65432,
  })

  // @ts-expect-error invalid port prefix
  t.throws(() => parsePgProxyPort('test'))
})
