import test from 'ava'
import { extractServiceURL } from '../../../src/cli/util'

test('extractServiceURL decomposes electric URL', async (t) => {
  t.deepEqual(extractServiceURL('http://localhost:5133'), {
    host: 'localhost',
    port: 5133,
  })

  t.deepEqual(extractServiceURL('https://www.my-website.com'), {
    host: 'www.my-website.com',
    port: undefined,
  })

  t.deepEqual(extractServiceURL('https://www.my-website.com:8132'), {
    host: 'www.my-website.com',
    port: 8132,
  })
})
