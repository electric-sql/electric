import { describe, it, expect } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerHorton } from '../src/agents/horton'
import { registerWorker } from '../src/agents/worker'
import type { BuiltinModelCatalog } from '../src/model-catalog'

const modelCatalog: BuiltinModelCatalog = {
  defaultChoice: {
    provider: `anthropic` as const,
    id: `claude-sonnet-4-6`,
    label: `Anthropic Claude Sonnet 4.6`,
    value: `anthropic:claude-sonnet-4-6`,
    reasoning: true,
    input: [`text`, `image`],
  },
  choices: [
    {
      provider: `anthropic` as const,
      id: `claude-sonnet-4-6`,
      label: `Anthropic Claude Sonnet 4.6`,
      value: `anthropic:claude-sonnet-4-6`,
      reasoning: true,
      input: [`text`, `image`],
    },
  ],
}

describe(`comments collection registration`, () => {
  it(`declares comments as an externally-writable state collection on horton and worker`, () => {
    const registry = createEntityRegistry()
    registerHorton(registry, { workingDirectory: `/tmp`, modelCatalog })
    registerWorker(registry, { workingDirectory: `/tmp`, modelCatalog })

    for (const name of [`horton`, `worker`]) {
      const def = registry.get(name)?.definition as any
      expect(def.state?.comments?.externallyWritable).toBe(true)
    }
  })
})
