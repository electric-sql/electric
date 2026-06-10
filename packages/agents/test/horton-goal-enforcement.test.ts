import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerHorton } from '../src/agents/horton'
import type { GoalEntry } from '@electric-ax/agents-runtime'
import type { BuiltinModelCatalog } from '../src/model-catalog'

const modelCatalog: BuiltinModelCatalog = {
  defaultChoice: {
    provider: `anthropic`,
    id: `claude-sonnet-4-6`,
    label: `Anthropic Claude Sonnet 4.6`,
    value: `anthropic:claude-sonnet-4-6`,
    reasoning: true,
    input: [`text`, `image`],
  },
  choices: [
    {
      provider: `anthropic`,
      id: `claude-sonnet-4-6`,
      label: `Anthropic Claude Sonnet 4.6`,
      value: `anthropic:claude-sonnet-4-6`,
      reasoning: true,
      input: [`text`, `image`],
    },
  ],
}

function goalEntry(overrides: Partial<GoalEntry> = {}): GoalEntry {
  return {
    id: `goal`,
    objective: `ship X`,
    status: `active`,
    tokenBudget: 1_000,
    tokensUsed: 0,
    createdAt: `2026-01-01T00:00:00.000Z`,
    updatedAt: `2026-01-01T00:00:00.000Z`,
    ...overrides,
  } as GoalEntry
}

async function runHandler(goal: GoalEntry | undefined) {
  const registry = createEntityRegistry()
  registerHorton(registry, { workingDirectory: `/tmp`, modelCatalog })
  const def = registry.get(`horton`)

  const useAgent = vi.fn()
  const updateGoalUsage = vi.fn()
  const replyText = vi.fn()
  // The run mock fires the captured onStepEnd (when wired) so the test can
  // exercise the budget-trip path the way a real step boundary would. The
  // budget accumulates uncachedInput + output — `input` (display sum incl.
  // cache reads) must NOT count, which the active-goal assertion verifies.
  const run = vi.fn(async () => {
    const config = useAgent.mock.calls[0]?.[0] as
      | {
          onStepEnd?: (stats: {
            input: number
            uncachedInput: number
            output: number
          }) => void
        }
      | undefined
    config?.onStepEnd?.({ input: 50_000, uncachedInput: 5_000, output: 100 })
  })

  const fakeCtx = {
    args: {},
    electricTools: [],
    events: [],
    firstWake: false,
    tags: {},
    db: { collections: { inbox: { toArray: [] }, runs: { toArray: [] } } },
    sandbox: {
      workingDirectory: `/work`,
      readFile: vi.fn(async () => {
        throw new Error(`ENOENT`)
      }),
    },
    slashCommands: { replaceOwned: vi.fn() },
    insertContext: vi.fn(),
    removeContext: vi.fn(),
    getContext: vi.fn(),
    useContext: vi.fn(),
    useAgent,
    agent: { run },
    getGoal: vi.fn(() => goal),
    updateGoalUsage,
    replyText,
  } as any

  await def!.definition.handler(fakeCtx, { type: `inbox` } as any)
  const agentConfig = useAgent.mock.calls[0]?.[0] as {
    onStepEnd?: unknown
    systemPrompt: string
  }
  return { agentConfig, updateGoalUsage, replyText, run }
}

describe(`horton goal enforcement gating`, () => {
  it(`wires enforcement and trips the budget for an active goal`, async () => {
    const { agentConfig, updateGoalUsage, replyText } = await runHandler(
      goalEntry({ status: `active`, tokenBudget: 1_000 })
    )

    expect(agentConfig.onStepEnd).toBeTypeOf(`function`)
    expect(agentConfig.systemPrompt).toContain(`Active goal`)
    // The simulated 5.1k-token step exceeds the 1k budget → status flip +
    // user-visible stop message.
    expect(updateGoalUsage).toHaveBeenCalledWith(5_100, {
      status: `budget_limited`,
    })
    expect(replyText).toHaveBeenCalledWith(
      expect.stringContaining(`token budget`)
    )
  })

  it(`does NOT wire enforcement for a budget_limited goal`, async () => {
    const { agentConfig, updateGoalUsage, replyText } = await runHandler(
      goalEntry({ status: `budget_limited`, tokensUsed: 1_500 })
    )

    expect(agentConfig.onStepEnd).toBeUndefined()
    expect(agentConfig.systemPrompt).not.toContain(`Active goal`)
    expect(updateGoalUsage).not.toHaveBeenCalled()
    expect(replyText).not.toHaveBeenCalled()
  })

  it(`does NOT wire enforcement for a complete goal`, async () => {
    const { agentConfig, updateGoalUsage } = await runHandler(
      goalEntry({ status: `complete`, tokensUsed: 900 })
    )

    expect(agentConfig.onStepEnd).toBeUndefined()
    expect(agentConfig.systemPrompt).not.toContain(`Active goal`)
    expect(updateGoalUsage).not.toHaveBeenCalled()
  })

  it(`does NOT wire enforcement when no goal exists`, async () => {
    const { agentConfig, updateGoalUsage } = await runHandler(undefined)

    expect(agentConfig.onStepEnd).toBeUndefined()
    expect(updateGoalUsage).not.toHaveBeenCalled()
  })
})
