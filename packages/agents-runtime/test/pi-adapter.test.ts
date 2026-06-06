import { describe, expect, it } from 'vitest'
import {
  createPiAgentAdapter,
  resolvePiModel,
  toAgentHistory,
} from '../src/pi-adapter'
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai'
import type { OutboundIdSeed } from '../src/outbound-bridge'
import type { LLMMessage } from '../src/types'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  AssistantMessage,
  Model,
  ToolResultMessage,
  UserMessage,
} from '@mariozechner/pi-ai'

interface PiAgentAdapterConfig {
  entityUrl: string
  epoch: number
  messages: Array<LLMMessage>
  outboundIdSeed: OutboundIdSeed
  writeEvent: (event: ChangeEvent) => void
}

describe(`createPiAgentAdapter`, () => {
  it(`returns an AgentAdapterFactory function`, () => {
    const factory = createPiAgentAdapter({
      systemPrompt: `Test system prompt`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [],
    })
    expect(typeof factory).toBe(`function`)
  })

  it(`factory produces an AgentHandle with all required methods`, () => {
    const factory = createPiAgentAdapter({
      systemPrompt: `Test system prompt`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [],
    })

    const config: PiAgentAdapterConfig = {
      entityUrl: `test/entity-1`,
      epoch: 1,
      messages: [],
      outboundIdSeed: { run: 0, step: 0, msg: 0, tc: 0 },
      writeEvent: (_event: ChangeEvent) => {},
    }

    const handle = factory(config)

    expect(typeof handle.run).toBe(`function`)
    expect(typeof handle.steer).toBe(`function`)
    expect(typeof handle.isRunning).toBe(`function`)
    expect(typeof handle.abort).toBe(`function`)
    expect(typeof handle.dispose).toBe(`function`)
  })

  it(`aborts an active run when the run signal is aborted`, async () => {
    let abortSeenResolve: (() => void) | null = null
    const abortSeen = new Promise<void>((resolve) => {
      abortSeenResolve = resolve
    })
    const abortedMessage: AssistantMessage = {
      role: `assistant`,
      content: [{ type: `text`, text: `` }],
      api: `anthropic-messages`,
      provider: `anthropic`,
      model: `claude-sonnet-4-5-20250929`,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: `aborted`,
      timestamp: Date.now(),
    }

    const factory = createPiAgentAdapter({
      systemPrompt: `Test system prompt`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [],
      streamFn: (_model, _context, options) => {
        const stream = createAssistantMessageEventStream()
        if (options?.signal?.aborted) {
          abortSeenResolve?.()
          stream.end(abortedMessage)
          return stream
        }
        options?.signal?.addEventListener(
          `abort`,
          () => {
            abortSeenResolve?.()
            stream.end(abortedMessage)
          },
          { once: true }
        )
        return stream
      },
    })

    const handle = factory({
      entityUrl: `test/entity-1`,
      epoch: 1,
      messages: [],
      outboundIdSeed: { run: 0, step: 0, msg: 0, tc: 0 },
      writeEvent: (_event: ChangeEvent) => {},
    })
    const controller = new AbortController()
    const runPromise = handle.run(`hello`, controller.signal)

    controller.abort()
    await abortSeen
    await expect(runPromise).resolves.toBeUndefined()
    expect(handle.isRunning()).toBe(false)
  })

  it(`settles an aborted run even if the model stream does not emit completion`, async () => {
    const factory = createPiAgentAdapter({
      systemPrompt: `Test system prompt`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [],
      streamFn: (_model, _context, options) => {
        const stream = createAssistantMessageEventStream()
        options?.signal?.addEventListener(`abort`, () => {}, { once: true })
        return stream
      },
    })

    const handle = factory({
      entityUrl: `test/entity-1`,
      epoch: 1,
      messages: [],
      outboundIdSeed: { run: 0, step: 0, msg: 0, tc: 0 },
      writeEvent: (_event: ChangeEvent) => {},
    })
    const controller = new AbortController()
    const runPromise = handle.run(`hello`, controller.signal)

    controller.abort()
    await expect(
      Promise.race([
        runPromise.then(() => `resolved`),
        new Promise((resolve) => setTimeout(() => resolve(`timed-out`), 50)),
      ])
    ).resolves.toBe(`resolved`)
    expect(handle.isRunning()).toBe(false)
  })

  it(`stops consuming model events after an abort signal`, async () => {
    let streamReadyResolve:
      | ((stream: ReturnType<typeof createAssistantMessageEventStream>) => void)
      | null = null
    const streamReady = new Promise<
      ReturnType<typeof createAssistantMessageEventStream>
    >((resolve) => {
      streamReadyResolve = resolve
    })
    const partialMessage: AssistantMessage = {
      role: `assistant`,
      content: [{ type: `text`, text: `` }],
      api: `anthropic-messages`,
      provider: `anthropic`,
      model: `claude-sonnet-4-5-20250929`,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: `aborted`,
      timestamp: Date.now(),
    }

    const factory = createPiAgentAdapter({
      systemPrompt: `Test system prompt`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [],
      streamFn: () => {
        const stream = createAssistantMessageEventStream()
        streamReadyResolve?.(stream)
        return stream
      },
    })
    const events: Array<ChangeEvent> = []
    const handle = factory({
      entityUrl: `test/entity-1`,
      epoch: 1,
      messages: [],
      outboundIdSeed: { run: 0, step: 0, msg: 0, tc: 0 },
      writeEvent: (event: ChangeEvent) => {
        events.push(event)
      },
    })
    const controller = new AbortController()
    const runPromise = handle.run(`hello`, controller.signal)
    const stream = await streamReady

    controller.abort()
    await runPromise
    stream.push({
      type: `text_delta`,
      contentIndex: 0,
      delta: `late token`,
      partial: partialMessage,
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: `text_delta`,
        value: expect.objectContaining({ delta: `late token` }),
      })
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: `run`,
        value: expect.objectContaining({
          status: `completed`,
          finish_reason: `aborted`,
        }),
      })
    )
  })

  it(`isRunning returns false initially`, () => {
    const factory = createPiAgentAdapter({
      systemPrompt: `Test system prompt`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [],
    })

    const config: PiAgentAdapterConfig = {
      entityUrl: `test/entity-1`,
      epoch: 1,
      messages: [],
      outboundIdSeed: { run: 0, step: 0, msg: 0, tc: 0 },
      writeEvent: (_event: ChangeEvent) => {},
    }

    const handle = factory(config)
    expect(handle.isRunning()).toBe(false)
  })

  it(`dispose sets running to false`, () => {
    const factory = createPiAgentAdapter({
      systemPrompt: `Test system prompt`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [],
    })

    const config: PiAgentAdapterConfig = {
      entityUrl: `test/entity-1`,
      epoch: 1,
      messages: [],
      outboundIdSeed: { run: 0, step: 0, msg: 0, tc: 0 },
      writeEvent: (_event: ChangeEvent) => {},
    }

    const handle = factory(config)
    handle.dispose()
    expect(handle.isRunning()).toBe(false)
  })
})

describe(`resolvePiModel`, () => {
  it(`defaults string model ids to the Anthropic provider`, () => {
    const model = resolvePiModel({
      model: `claude-sonnet-4-5-20250929`,
    })

    expect(model.provider).toBe(`anthropic`)
    expect(model.id).toBe(`claude-sonnet-4-5-20250929`)
  })

  it(`resolves string model ids against an explicit provider`, () => {
    const model = resolvePiModel({
      provider: `openai`,
      model: `gpt-4o-mini`,
    })

    expect(model.provider).toBe(`openai`)
    expect(model.id).toBe(`gpt-4o-mini`)
  })

  it(`resolves Moonshot string model ids to OpenAI-compatible models`, () => {
    const model = resolvePiModel({
      provider: `moonshot`,
      model: `kimi-k2.6`,
    })

    expect(model.provider).toBe(`moonshot`)
    expect(model.id).toBe(`kimi-k2.6`)
    expect(model.api).toBe(`openai-completions`)
    expect(model.baseUrl).toBe(`https://api.moonshot.ai/v1`)
  })

  it(`accepts custom Model objects directly`, () => {
    const customModel: Model<`openai-completions`> = {
      id: `deepseek-v4-flash`,
      name: `DeepSeek V4 Flash`,
      api: `openai-completions`,
      provider: `deepseek`,
      baseUrl: `https://api.deepseek.com`,
      reasoning: false,
      input: [`text`],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    }

    expect(resolvePiModel({ model: customModel })).toBe(customModel)
  })

  it(`throws a clear error for unknown provider model ids`, () => {
    expect(() =>
      resolvePiModel({
        provider: `openai`,
        model: `definitely-not-a-real-model`,
      })
    ).toThrow(
      `[agent-runtime] Unknown model "definitely-not-a-real-model" for provider "openai"`
    )
  })
})

describe(`toAgentHistory`, () => {
  it(`returns empty array for empty messages`, () => {
    expect(toAgentHistory([])).toEqual([])
  })

  it(`converts user context messages to user messages`, () => {
    const messages: Array<LLMMessage> = [
      { role: `user`, content: `Hello agent` },
    ]

    const history = toAgentHistory(messages)
    expect(history).toHaveLength(1)
    const msg = history[0] as UserMessage | undefined
    expect(msg?.role).toBe(`user`)
    const content = msg?.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toBe(`Hello agent`)
  })

  it(`converts assistant context messages to assistant messages`, () => {
    const messages: Array<LLMMessage> = [
      { role: `assistant`, content: `Hello world` },
    ]

    const history = toAgentHistory(messages)
    expect(history).toHaveLength(1)
    const msg = history[0] as AssistantMessage | undefined
    expect(msg?.role).toBe(`assistant`)
    const content = msg?.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toBe(`Hello world`)
  })

  it(`includes custom event turns from the context pipeline as user messages`, () => {
    const messages: Array<LLMMessage> = [
      {
        role: `user`,
        content: `{"key":"note-1","value":"remembered"}`,
      },
    ]

    const history = toAgentHistory(messages)
    expect(history).toHaveLength(1)
    const msg = history[0] as UserMessage | undefined
    expect(msg?.role).toBe(`user`)
    const content = msg?.content as Array<{ type: string; text: string }>
    expect(content[0]?.text).toBe(`{"key":"note-1","value":"remembered"}`)
  })

  it(`preserves tool call ids and names when rebuilding tool results`, () => {
    const messages: Array<LLMMessage> = [
      {
        role: `tool_call`,
        content: `lookup`,
        toolCallId: `tc-0`,
        toolName: `lookup`,
        toolArgs: { q: `hello` },
      },
      {
        role: `tool_result`,
        content: `done`,
        toolCallId: `tc-0`,
        isError: false,
      },
    ]

    const history = toAgentHistory(messages)
    expect(history).toHaveLength(2)
    const toolResult = history[1] as ToolResultMessage | undefined
    expect(toolResult?.role).toBe(`toolResult`)
    expect(toolResult?.toolCallId).toBe(`tc-0`)
    expect(toolResult?.toolName).toBe(`lookup`)
  })

  it(`preserves ordering across message types`, () => {
    const messages: Array<LLMMessage> = [
      { role: `user`, content: `Question` },
      { role: `assistant`, content: `Answer` },
    ]

    const history = toAgentHistory(messages)
    expect(history).toHaveLength(2)
    const [first, second] = history as Array<
      UserMessage | AssistantMessage | undefined
    >
    expect(first?.role).toBe(`user`)
    expect(second?.role).toBe(`assistant`)
  })

  it(`merges adjacent assistant text messages into one text block`, () => {
    const messages: Array<LLMMessage> = [
      { role: `user`, content: `Question` },
      { role: `assistant`, content: `First chunk.` },
      { role: `assistant`, content: ` Second chunk.` },
    ]

    const history = toAgentHistory(messages)

    expect(history).toHaveLength(2)
    const assistant = history[1] as AssistantMessage
    expect(assistant.role).toBe(`assistant`)
    expect(assistant.content).toEqual([
      { type: `text`, text: `First chunk. Second chunk.` },
    ])
  })

  it(`merges assistant text and tool_call into a single assistant message`, () => {
    const messages: Array<LLMMessage> = [
      { role: `user`, content: `Help me` },
      { role: `assistant`, content: `Let me look that up` },
      {
        role: `tool_call`,
        content: `lookup`,
        toolCallId: `tc-0`,
        toolName: `lookup`,
        toolArgs: { q: `hello` },
      },
      {
        role: `tool_result`,
        content: `found it`,
        toolCallId: `tc-0`,
        isError: false,
      },
    ]

    const history = toAgentHistory(messages)

    const assistantMessages = history.filter((m) => m.role === `assistant`)
    expect(assistantMessages).toHaveLength(1)

    const assistant = assistantMessages[0] as AssistantMessage
    expect(assistant.content).toHaveLength(2)
    expect(assistant.content[0]).toMatchObject({
      type: `text`,
      text: `Let me look that up`,
    })
    expect(assistant.content[1]).toMatchObject({
      type: `toolCall`,
      id: `tc-0`,
      name: `lookup`,
    })
  })

  it(`keeps separate assistant turns after tool results`, () => {
    const messages: Array<LLMMessage> = [
      { role: `user`, content: `Do two things` },
      { role: `assistant`, content: `I will do both` },
      {
        role: `tool_call`,
        content: `{}`,
        toolCallId: `tc-0`,
        toolName: `tool_a`,
        toolArgs: {},
      },
      {
        role: `tool_result`,
        content: `a`,
        toolCallId: `tc-0`,
        isError: false,
      },
      { role: `assistant`, content: `Now the second` },
      {
        role: `tool_call`,
        content: `{}`,
        toolCallId: `tc-1`,
        toolName: `tool_b`,
        toolArgs: {},
      },
      {
        role: `tool_result`,
        content: `b`,
        toolCallId: `tc-1`,
        isError: false,
      },
      { role: `assistant`, content: `All done` },
    ]

    const history = toAgentHistory(messages)

    for (let i = 1; i < history.length; i++) {
      if (history[i]!.role === `assistant`) {
        expect(history[i - 1]!.role).not.toBe(`assistant`)
      }
    }
  })
})
