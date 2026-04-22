import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agent-runtime'
import { registerWorker } from '../src/electric-agents/agents/worker'

describe(`worker tool-list assembly`, () => {
  it(`grants only the tools the spawner asked for; never includes ctx.electricTools`, async () => {
    const registry = createEntityRegistry()
    registerWorker(registry, { workingDirectory: `/tmp` })

    const def = registry.get(`worker`)
    expect(def).toBeDefined()

    const useAgent = vi.fn(() => ({ run: vi.fn(async () => {}) }))
    const fakeCtx = {
      args: { systemPrompt: `do a thing`, tools: [`bash`] },
      electricTools: [
        {
          name: `electric_agents.scheduleCron`,
          description: ``,
          parameters: {} as any,
        },
        {
          name: `electric_agents.send`,
          description: ``,
          parameters: {} as any,
        },
      ],
      useAgent,
      agent: { run: vi.fn(async () => {}) },
      spawn: vi.fn(),
    } as any

    await def!.definition.handler(fakeCtx, {} as any)

    expect(useAgent).toHaveBeenCalledTimes(1)
    const mockCalls = useAgent.mock.calls as unknown as Array<
      [{ tools: Array<{ name: string }> }]
    >
    const firstCall = mockCalls[0]
    expect(firstCall).toBeDefined()
    const config = firstCall![0]
    const names = config.tools.map((t) => t.name)
    expect(names).toEqual([`bash`])
    expect(names).not.toContain(`electric_agents.scheduleCron`)
    expect(names).not.toContain(`electric_agents.send`)
  })
})
