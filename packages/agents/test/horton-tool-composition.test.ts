import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import {
  isMcpToolsSentinel,
  type McpToolsSentinel,
} from '@electric-ax/agents-mcp'
import { extractFirstUserMessage, registerHorton } from '../src/agents/horton'
import { createBuiltinElectricTools } from '../src/bootstrap'
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

// Characterization: Horton today builds a fixed built-in toolset and
// unconditionally appends `...mcp.tools()` — every registered MCP server,
// no allowlist (`horton.ts:396`). The tests below capture that composition
// so a follow-up PR can flip MCP to an opt-in allowlist with a one-line
// expectation change.
async function captureAgentConfig(
  args: Record<string, unknown> = {},
  electricTools: Array<any> = [],
  ctxOverrides: Record<string, unknown> = {}
) {
  const registry = createEntityRegistry()
  registerHorton(registry, { workingDirectory: `/tmp`, modelCatalog })
  const useAgent = vi.fn(() => ({ run: vi.fn(async () => {}) }))
  const fakeCtx = {
    args,
    electricTools,
    events: [],
    firstWake: false,
    tags: {},
    db: { collections: { inbox: { toArray: [] } } },
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
    agent: { run: vi.fn(async () => {}) },
    setTag: vi.fn(async () => {}),
    ...ctxOverrides,
  } as any
  await registry
    .get(`horton`)!
    .definition.handler(fakeCtx, { type: `inbox` } as any)
  expect(useAgent).toHaveBeenCalledTimes(1)
  const cfg = (
    useAgent.mock.calls as unknown as Array<
      [{ tools: Array<unknown>; systemPrompt: string }]
    >
  )[0]![0]
  return cfg
}

async function captureToolset(args: Record<string, unknown> = {}) {
  const cfg = await captureAgentConfig(args)
  return cfg.tools
}

function createElectricToolsContext() {
  return {
    entityUrl: `/horton/smoke/main`,
    entityType: `horton`,
    args: {},
    db: {
      collections: { manifests: { toArray: [] } },
      utils: { awaitTxId: vi.fn(async () => {}) },
    },
    events: [],
    upsertCronSchedule: vi.fn(async () => ({ txid: `tx-cron` })),
    upsertFutureSendSchedule: vi.fn(async () => ({ txid: `tx-future` })),
    deleteSchedule: vi.fn(async () => ({ txid: `tx-delete` })),
    listWebhookSources: vi.fn(async () => []),
    subscribeToWebhookSource: vi.fn(async () => ({
      txid: `tx-subscribe`,
      subscription: {
        id: `subscription`,
        entityUrl: `/horton/smoke/main`,
        webhookKey: `github`,
        params: {},
        filterApplied: false,
        contractRevision: 1,
        sourceUrl: `/_webhooks/github`,
        sourceType: `webhook`,
        manifestKey: `webhook-source:subscription`,
        lifetime: { kind: `until_entity_stopped` },
        createdBy: `tool`,
        createdAt: new Date(0).toISOString(),
      },
    })),
    unsubscribeFromWebhookSource: vi.fn(async () => ({ txid: `tx-unsubscribe` })),
  } as any
}

describe(`horton tool composition`, () => {
  it(`extracts the first user message from lightweight inbox collection facades`, async () => {
    const ctx = {
      db: {
        collections: {
          inbox: {
            toArray: [
              { key: `m-2`, from: `user`, payload: `second`, _seq: 2 },
              { key: `m-0`, from: `system`, payload: `ignored`, _seq: 0 },
              { key: `m-1`, from: `user`, payload: { text: `first` }, _seq: 1 },
            ],
          },
        },
      },
    } as any

    await expect(extractFirstUserMessage(ctx)).resolves.toBe(`first`)
  })

  it(`orders title candidates with the _seq fallback convention`, async () => {
    const ctx = {
      db: {
        collections: {
          inbox: {
            toArray: [
              { key: `m-2`, from: `user`, payload: `second`, _seq: 2 },
              { key: `m-unsequenced`, from: `user`, payload: `fallback` },
              { key: `m-1`, from: `user`, payload: `first`, _seq: 1 },
            ],
          },
        },
      },
    } as any

    await expect(extractFirstUserMessage(ctx)).resolves.toBe(`fallback`)
  })

  it(`includes input attachments in the title source text`, async () => {
    const ctx = {
      db: {
        collections: {
          inbox: {
            toArray: [
              {
                key: `m-1`,
                from: `user`,
                payload: { text: `Can you critique this UI?` },
                _seq: 1,
              },
            ],
          },
          manifests: {
            toArray: [
              {
                kind: `attachment`,
                id: `att-1`,
                subject: { type: `inbox`, key: `m-1` },
                role: `input`,
                mimeType: `image/png`,
                filename: `screen.png`,
              },
            ],
          },
        },
      },
    } as any

    await expect(extractFirstUserMessage(ctx)).resolves.toBe(
      [`Can you critique this UI?`, `Attached image: screen.png`].join(`\n`)
    )
  })

  it(`can title an image-only first message from its attachment metadata`, async () => {
    const ctx = {
      db: {
        collections: {
          inbox: {
            toArray: [
              { key: `m-1`, from: `user`, payload: { text: `` }, _seq: 1 },
            ],
          },
          manifests: {
            toArray: [
              {
                kind: `attachment`,
                id: `att-1`,
                subject: { type: `inbox`, key: `m-1` },
                role: `input`,
                mimeType: `image/png`,
                filename: `screen.png`,
              },
            ],
          },
        },
      },
    } as any

    await expect(extractFirstUserMessage(ctx)).resolves.toBe(
      `Attached image: screen.png`
    )
  })

  it(`adds webhook source and schedule tools through the built-in electric tool factory`, async () => {
    const tools = await createBuiltinElectricTools()(
      createElectricToolsContext()
    )
    const names = tools.map((t) => t.name)

    expect(names).toEqual(
      expect.arrayContaining([
        `list_webhook_sources`,
        `subscribe_webhook_source`,
        `list_webhook_source_subscriptions`,
        `unsubscribe_webhook_source`,
        `upsert_cron_schedule`,
        `delete_schedule`,
        `list_schedules`,
      ])
    )
    expect(
      tools.find((tool) => tool.name === `list_webhook_sources`)?.description
    ).toContain(`external webhook feeds`)
    expect(
      tools.find((tool) => tool.name === `list_webhook_sources`)?.description
    ).not.toContain(`this entity`)
    expect(
      tools.find((tool) => tool.name === `list_webhook_source_subscriptions`)
        ?.description
    ).not.toContain(`manifest-backed`)
  })

  it(`includes webhook source and schedule electric tools in Horton and describes them in the prompt`, async () => {
    const electricTools = await createBuiltinElectricTools()(
      createElectricToolsContext()
    )
    const cfg = await captureAgentConfig({}, electricTools)
    const names = cfg.tools
      .filter((t) => !isMcpToolsSentinel(t))
      .map((t) => (t as { name: string }).name)

    expect(names).toContain(`list_webhook_sources`)
    expect(names).toContain(`subscribe_webhook_source`)
    expect(names).toContain(`upsert_cron_schedule`)
    expect(names).toContain(`delete_schedule`)
    expect(names).toContain(`list_schedules`)
    expect(cfg.systemPrompt).toContain(`list_webhook_sources`)
    expect(cfg.systemPrompt).toContain(`subscribe_webhook_source`)
    expect(cfg.systemPrompt).toContain(`upsert_cron_schedule`)
    expect(cfg.systemPrompt).toContain(`delete_schedule`)
    expect(cfg.systemPrompt).toContain(`list_schedules`)
  })

  it(`includes the default built-in toolset`, async () => {
    const tools = await captureToolset()
    const names = tools
      .filter((t) => !isMcpToolsSentinel(t))
      .map((t) => (t as { name: string }).name)
    expect(names).toEqual(
      expect.arrayContaining([
        `bash`,
        `read`,
        `write`,
        `edit`,
        `web_search`,
        `fetch_url`,
        `spawn_worker`,
        `set_title`,
        `send`,
      ])
    )
  })

  it(`executes set_title with trimmed non-empty title`, async () => {
    const setTag = vi.fn(async () => {})
    const cfg = await captureAgentConfig({}, [], { setTag })
    const tool = cfg.tools.find(
      (t) =>
        !isMcpToolsSentinel(t) && (t as { name?: string }).name === `set_title`
    ) as { execute: (id: string, params: unknown) => Promise<any> }

    const result = await tool.execute(`call-1`, { title: `  Better title  ` })

    expect(setTag).toHaveBeenCalledWith(`title`, `Better title`)
    expect(result.details).toEqual({ updated: true, title: `Better title` })
  })

  it(`rejects empty set_title input`, async () => {
    const setTag = vi.fn(async () => {})
    const cfg = await captureAgentConfig({}, [], { setTag })
    const tool = cfg.tools.find(
      (t) =>
        !isMcpToolsSentinel(t) && (t as { name?: string }).name === `set_title`
    ) as { execute: (id: string, params: unknown) => Promise<any> }

    const result = await tool.execute(`call-1`, { title: `   ` })

    expect(setTag).not.toHaveBeenCalled()
    expect(result.details).toEqual({ updated: false })
    expect(result.content[0].text).toContain(`non-empty`)
  })

  it(`returns structured error when setTag throws`, async () => {
    const setTag = vi.fn().mockRejectedValue(new Error(`Network error`))
    const cfg = await captureAgentConfig({}, [], { setTag })
    const tool = cfg.tools.find(
      (t) =>
        !isMcpToolsSentinel(t) && (t as { name?: string }).name === `set_title`
    ) as { execute: (id: string, params: unknown) => Promise<any> }

    const result = await tool.execute(`call-1`, { title: `New title` })

    expect(setTag).toHaveBeenCalledWith(`title`, `New title`)
    expect(result.details).toEqual({ updated: false })
    expect(result.content[0].text).toContain(`Network error`)
  })

  it(`appends an unconditional MCP tools sentinel with no allowlist`, async () => {
    const tools = await captureToolset()
    const sentinels = tools.filter(isMcpToolsSentinel) as McpToolsSentinel[]
    expect(sentinels).toHaveLength(1)
    expect(sentinels[0]!.allowlist).toBeUndefined()
  })

  it(`MCP sentinel is present regardless of args`, async () => {
    const withArgs = await captureToolset({
      model: `anthropic:claude-sonnet-4-6`,
    })
    expect(withArgs.some(isMcpToolsSentinel)).toBe(true)
  })
})
