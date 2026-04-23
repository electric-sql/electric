import { beforeEach, describe, expect, it, vi } from 'vitest'
import { timelineMessages, timelineToMessages } from '../src/timeline-context'
import {
  buildStreamFixture,
  createTestHandlerContext,
} from './helpers/context-test-helpers'

const capturedMessages: Array<Array<unknown>> = []

vi.mock(`../src/pi-adapter`, async (importOriginal) => {
  const orig = await importOriginal<any>()
  return {
    ...orig,
    createPiAgentAdapter:
      (_cfg: Parameters<typeof orig.createPiAgentAdapter>[0]) =>
      (adapterArgs: { messages: Array<unknown> }) => ({
        run: () => {
          capturedMessages.push(adapterArgs.messages)
          return Promise.resolve()
        },
      }),
  }
})

describe(`zero-config default path`, () => {
  beforeEach(() => {
    capturedMessages.length = 0
  })

  it(`timelineMessages default projection is byte-identical to legacy for a no-context stream`, () => {
    const db = buildStreamFixture([
      { kind: `message_received`, at: 1, value: { payload: `hello` } },
      { kind: `wake`, at: 2, value: { payload: `tick` } },
    ])

    const fresh = timelineMessages(db).map(({ at: _at, ...rest }) => rest)
    const legacy = timelineToMessages(db)
    expect(fresh).toEqual(legacy)
  })

  it(`agent.run without useContext hands the adapter legacy-identical messages`, async () => {
    const db = buildStreamFixture([
      { kind: `message_received`, at: 1, value: { payload: `hello` } },
      { kind: `wake`, at: 2, value: { payload: `tick` } },
    ])
    const { ctx } = createTestHandlerContext({ db })

    ctx.useAgent({ systemPrompt: `t`, model: `t`, tools: [] })
    await ctx.agent.run()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toEqual(timelineToMessages(db))
  })
})
