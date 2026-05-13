import { describe, it, expect, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerDiscordBot } from '../src/entity'

describe(`registerDiscordBot`, () => {
  it(`registers a discord-bot entity type`, () => {
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
    const def = registry.get(`discord-bot`)
    expect(def).toBeDefined()
    expect(def?.definition.description).toMatch(/discord/i)
  })

  it(`exposes discord and delegate tools on the agent`, async () => {
    const registry = createEntityRegistry()
    const useAgent = vi
      .fn()
      .mockReturnValue({ run: vi.fn().mockResolvedValue(undefined) })
    const run = vi.fn().mockResolvedValue(undefined)
    registerDiscordBot(registry, {
      appId: `a`,
      botToken: `t`,
      github: { repo: `o/r`, token: `gh` },
      hortonRuntime: { agentsServerUrl: `http://a`, entityType: `horton` },
      modelCatalog: {
        primary: { provider: `anthropic`, model: `m`, apiKey: `k` },
      } as any,
    })
    const def = registry.get(`discord-bot`)!.definition
    const ctx: any = {
      entityUrl: `http://a/discord-bot-thread1`,
      args: { threadId: `thread1` },
      events: [],
      insertContext: vi.fn(),
      runtimeServerClient: { spawnEntity: vi.fn() },
      useAgent,
      agent: { run },
    }
    await def.handler(ctx, {} as any)
    expect(useAgent).toHaveBeenCalledTimes(1)
    const cfg = useAgent.mock.calls[0][0]
    const names = cfg.tools.map((t: any) => t.name).sort()
    expect(names).toContain(`post_message`)
    expect(names).toContain(`spawn_horton`)
    expect(names).toContain(`read_channel_around_message`)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
