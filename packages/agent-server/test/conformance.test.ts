import fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe } from 'vitest'
import { DurableStreamTestServer } from '@durable-streams/server'
import {
  createMockStreamFn,
  runCliConformanceTests,
  runElectricAgentsConformanceTests,
  runMockAgentCliTests,
  runMockAgentTests,
} from '../../agent-server-conformance-tests/src/index'
import { ElectricAgentsServer } from '../src/server'
import {
  TEST_ELECTRIC_URL,
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'

const CLI_BIN = path.resolve(
  __dirname,
  `../../electric-agents-cli/src/index.ts`
)
const MOCK_STREAM_FN = createMockStreamFn(
  `I am a mock agent response. The answer is 42.`
)
const describeCli = fs.existsSync(CLI_BIN) ? describe : describe.skip

describe(`Electric Agents Entity Runtime`, () => {
  let dsServer: DurableStreamTestServer | null = null
  let electricAgentsServer: ElectricAgentsServer | null = null
  const config = { baseUrl: `` }

  beforeAll(async () => {
    dsServer = new DurableStreamTestServer({
      port: 0,
      longPollTimeout: 500,
      webhooks: true,
    })
    await Promise.all([resetElectricAgentsTestBackend(), dsServer.start()])

    electricAgentsServer = new ElectricAgentsServer({
      durableStreamsUrl: dsServer.url,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
      electricUrl: TEST_ELECTRIC_URL,
    })
    config.baseUrl = await electricAgentsServer.start()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([electricAgentsServer?.stop(), dsServer?.stop()])
  }, 120_000)

  runElectricAgentsConformanceTests(config)
})

describeCli(`Electric Agents CLI`, () => {
  let dsServer: DurableStreamTestServer | null = null
  let electricAgentsServer: ElectricAgentsServer | null = null
  const config = { baseUrl: ``, cliBin: CLI_BIN }

  beforeAll(async () => {
    dsServer = new DurableStreamTestServer({
      port: 0,
      longPollTimeout: 500,
      webhooks: true,
    })
    await Promise.all([resetElectricAgentsTestBackend(), dsServer.start()])

    electricAgentsServer = new ElectricAgentsServer({
      durableStreamsUrl: dsServer.url,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
      electricUrl: TEST_ELECTRIC_URL,
    })
    config.baseUrl = await electricAgentsServer.start()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([electricAgentsServer?.stop(), dsServer?.stop()])
  }, 120_000)

  runCliConformanceTests(config)
})

describe(`Electric Agents Mock Agent`, () => {
  let dsServer: DurableStreamTestServer | null = null
  let electricAgentsServer: ElectricAgentsServer | null = null
  const config = { baseUrl: `` }

  beforeAll(async () => {
    dsServer = new DurableStreamTestServer({
      port: 0,
      longPollTimeout: 500,
      webhooks: true,
    })
    await Promise.all([resetElectricAgentsTestBackend(), dsServer.start()])

    electricAgentsServer = new ElectricAgentsServer({
      durableStreamsUrl: dsServer.url,
      port: 0,
      mockStreamFn: MOCK_STREAM_FN,
      postgresUrl: TEST_POSTGRES_URL,
      electricUrl: TEST_ELECTRIC_URL,
    })
    config.baseUrl = await electricAgentsServer.start()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([electricAgentsServer?.stop(), dsServer?.stop()])
  }, 120_000)

  runMockAgentTests(config)
})

describeCli(`Electric Agents CLI with Mock Agent`, () => {
  let dsServer: DurableStreamTestServer | null = null
  let electricAgentsServer: ElectricAgentsServer | null = null
  const config = { baseUrl: ``, cliBin: CLI_BIN }

  beforeAll(async () => {
    dsServer = new DurableStreamTestServer({
      port: 0,
      longPollTimeout: 500,
      webhooks: true,
    })
    await Promise.all([resetElectricAgentsTestBackend(), dsServer.start()])

    electricAgentsServer = new ElectricAgentsServer({
      durableStreamsUrl: dsServer.url,
      port: 0,
      mockStreamFn: MOCK_STREAM_FN,
      postgresUrl: TEST_POSTGRES_URL,
      electricUrl: TEST_ELECTRIC_URL,
    })
    config.baseUrl = await electricAgentsServer.start()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([electricAgentsServer?.stop(), dsServer?.stop()])
  }, 120_000)

  runMockAgentCliTests(config)
})
