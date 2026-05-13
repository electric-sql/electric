// test/integration/end-to-end.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { processGatewayEvent } from '../../src/adapter/host-node'
import { registerDiscordBot } from '../../src/entity'
import type { GatewayMapOutput } from '../../src/adapter/gateway-mapper'

describe(`discord-bot end-to-end (adapter → wake → entity)`, () => {
  it(`creates a thread on mention, primes context, dispatches wake, and invokes the agent`, async () => {
    // --- adapter phase ---
    const restGet = vi.fn().mockImplementation(async (path: string) => {
      if (path.includes(`/channels/c1/messages?limit=`)) {
        return [
          {
            id: `p1`,
            author: { username: `alice` },
            content: `prior`,
            timestamp: `2026-05-13T10:00:00Z`,
          },
        ]
      }
      return []
    })
    const restPost = vi.fn().mockResolvedValue({ id: `new-thread` })
    const rest = {
      get: restGet,
      post: restPost,
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }

    const wakes: any[] = []
    const postWake = async (payload: any) => {
      wakes.push(payload)
    }

    const pre: NonNullable<GatewayMapOutput> = {
      kind: `pre_thread_mention`,
      channelId: `c1`,
      messageId: `m1`,
      userId: `u1`,
      content: `fix issue 4312`,
    }

    await processGatewayEvent(pre, {
      rest: rest as any,
      postWake,
      primeMessageLimit: 5,
    })

    // Verify the adapter produced exactly one wake with the expected shape.
    expect(wakes).toHaveLength(1)
    const wake = wakes[0]
    expect(wake.entityId).toBe(`new-thread`)
    expect(wake.message.kind).toBe(`mention`)
    expect(wake.message.primeMessages).toHaveLength(1)

    // --- entity phase ---
    // Simulate what agents-server would do: look up the registered handler and
    // call it with a HandlerContext carrying the wake event.
    const registry = createEntityRegistry()
    registerDiscordBot(registry, {
      appId: `a`,
      botToken: `t`,
      github: { repo: `o/r`, token: `gh` },
      hortonRuntime: { agentsServerUrl: `http://a`, entityType: `horton` },
      modelCatalog: {
        primary: { provider: `anthropic`, model: `m`, apiKey: `k` },
      } as any,
    })

    const insertContext = vi.fn()
    const useAgent = vi.fn()
    const agentRun = vi.fn().mockResolvedValue(undefined)

    const def = registry.get(`discord-bot`)!.definition

    // HandlerContext shape as understood from the real entity.ts:
    //   ctx.insertContext(key, { name, content, attrs })
    //   ctx.runtimeServerClient  (accessed via cast in entity.ts)
    //   ctx.useAgent({ systemPrompt, tools, ...modelConfig })
    //   ctx.agent.run()
    //
    // The handler accepts a single ctx argument; passing a second arg is
    // harmless (mirrors the existing entity.test.ts pattern).
    await def.handler(
      {
        entityUrl: `http://a/discord-bot-new-thread`,
        args: { threadId: `new-thread` },
        events: [{ payload: wake.message }],
        insertContext,
        runtimeServerClient: { spawnEntity: vi.fn() },
        useAgent,
        agent: { run: agentRun },
      } as any,
      {} as any
    )

    // insertContext should have been called once (one prime entry).
    expect(insertContext).toHaveBeenCalledTimes(1)

    // The key (first arg) and the entry name (inside second arg) must both
    // contain "discord-prime-c1-new-thread" — built by buildPrimeContextEntries.
    const firstInsertArgs = insertContext.mock.calls[0]
    const concat = JSON.stringify(firstInsertArgs)
    expect(concat).toContain(`discord-prime-c1-new-thread`)

    // useAgent should have been called once with discord + horton tools.
    expect(useAgent).toHaveBeenCalledTimes(1)
    const agentCfg = useAgent.mock.calls[0][0] as any
    const toolNames: string[] = agentCfg.tools.map((t: any) => t.name)
    expect(toolNames).toEqual(
      expect.arrayContaining([
        `post_message`,
        `spawn_horton`,
        `read_channel_around_message`,
      ])
    )

    // agent.run() must have been awaited.
    expect(agentRun).toHaveBeenCalledTimes(1)
  })
})
