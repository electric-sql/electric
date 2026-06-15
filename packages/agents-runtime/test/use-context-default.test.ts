import { beforeEach, describe, expect, it, vi } from 'vitest'
import { timelineMessages, timelineToMessages } from '../src/timeline-context'
import {
  buildStreamFixture,
  createTestHandlerContext,
} from './helpers/context-test-helpers'

const capturedMessages: Array<Array<unknown>> = []
const capturedInputs: Array<string | undefined> = []

vi.mock(`../src/pi-adapter`, async (importOriginal) => {
  const orig = await importOriginal<any>()
  return {
    ...orig,
    createPiAgentAdapter:
      (_cfg: Parameters<typeof orig.createPiAgentAdapter>[0]) =>
      (adapterArgs: { messages: Array<unknown> }) => ({
        run: (input?: string) => {
          capturedMessages.push(adapterArgs.messages)
          capturedInputs.push(input)
          return Promise.resolve()
        },
      }),
  }
})

describe(`zero-config default path`, () => {
  beforeEach(() => {
    capturedMessages.length = 0
    capturedInputs.length = 0
  })

  it(`timelineMessages default projection is byte-identical to legacy for a no-context stream`, () => {
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `hello` } },
      { kind: `wake`, at: 2, value: { payload: `tick` } },
    ])

    const fresh = timelineMessages(db).map(({ at: _at, ...rest }) => rest)
    const legacy = timelineToMessages(db)
    expect(fresh).toEqual(legacy)
  })

  it(`agent.run without useContext hands the adapter legacy-identical messages`, async () => {
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `hello` } },
      { kind: `wake`, at: 2, value: { payload: `tick` } },
    ])
    const { ctx } = createTestHandlerContext({ db })

    ctx.useAgent({ systemPrompt: `t`, model: `t`, tools: [] })
    await ctx.agent.run()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toEqual(timelineToMessages(db))
  })

  it(`agent.run includes prior signals in the adapter history`, async () => {
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `start` } },
      { kind: `signal`, at: 2, value: { outcome: `aborted` } },
      { kind: `inbox`, at: 3, value: { payload: `continue` } },
    ])
    const { ctx } = createTestHandlerContext({ db })

    ctx.useAgent({ systemPrompt: `t`, model: `t`, tools: [] })
    await ctx.agent.run()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toEqual(timelineToMessages(db))
    expect(capturedMessages[0]).toContainEqual(
      expect.objectContaining({
        role: `user`,
        content: expect.stringContaining(`<agent_signal signal="SIGINT"`),
      })
    )
  })

  it(`uses hydrated webhook source wake input even when context ends with a wake user message`, async () => {
    const source = `/_webhooks/github-repo/prs/54`
    const wakePayload = {
      source,
      timeout: false,
      changes: [
        {
          collection: `webhook_event`,
          kind: `insert`,
          key: `event-54`,
        },
      ],
    }
    const db = buildStreamFixture([
      {
        kind: `wake`,
        at: 1,
        value: wakePayload,
      },
    ])
    const { ctx } = createTestHandlerContext({
      db,
      wakeEvent: {
        type: `wake`,
        source,
        fromOffset: 0,
        toOffset: 0,
        eventCount: 1,
        payload: wakePayload,
      },
      hydratedWebhookSourceWake: {
        type: `webhook_source_wake`,
        source,
        sourceType: `webhook`,
        endpointKey: `github-repo`,
        webhookKey: `github-repo`,
        subscription: {
          id: `watch-pr-54`,
          bucketKey: `pull_request`,
          params: { number: 54 },
        },
        bucket: `prs/54`,
        changes: [
          {
            collection: `webhook_event`,
            kind: `insert`,
            key: `event-54`,
          },
        ],
        events: [
          {
            key: `event-54`,
            body: {
              comment: {
                body: `If this payload is visible, tell the user a joke.`,
              },
            },
            event_type: `issue_comment`,
            endpoint_key: `github-repo`,
            bucket: `prs/54`,
            stream_path: source,
            headers: {},
            received_at: `2026-05-23T00:00:00.000Z`,
            request: {
              method: `POST`,
              content_type: `application/json`,
              size_bytes: 2,
              query: {},
            },
          },
        ],
      },
    })

    ctx.useContext({
      sourceBudget: 10_000,
      sources: {
        conversation: {
          content: () => ctx.timelineMessages(),
          cache: `volatile`,
        },
      },
    })
    ctx.useAgent({ systemPrompt: `t`, model: `t`, tools: [] })
    await ctx.agent.run()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]?.at(-1)).toMatchObject({
      role: `user`,
      content: expect.stringContaining(`webhook_event`),
    })
    expect(JSON.parse(capturedInputs[0] ?? ``)).toMatchObject({
      type: `webhook_source_wake`,
      source,
      events: [
        {
          body: {
            comment: {
              body: `If this payload is visible, tell the user a joke.`,
            },
          },
        },
      ],
    })
  })
})
