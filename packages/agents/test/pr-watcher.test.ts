import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerPrWatcher } from '../src/agents/pr-watcher'
import { createBuiltinModelCatalog } from '../src/model-catalog'

describe(`pr-watcher`, () => {
  it(`registers a "pr-watcher" entity type with required arg validation`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    registerPrWatcher(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
    })
    const def = registry.get(`pr-watcher`)
    expect(def).toBeDefined()
    expect(def!.definition.description).toMatch(/PR shepherd/i)
  })

  it(`on scan, spawns pr-manager for any agents-labeled PR not in ledger`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    const fetchPrs = vi
      .fn()
      .mockResolvedValue([
        { number: 42, head_branch: `feat`, labels: [`agents`] },
      ])
    registerPrWatcher(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
      fetchPrs,
    })

    const spawn = vi
      .fn()
      .mockResolvedValue({ entityUrl: `http://x/pr-manager/42/main` })
    const ledgerInsert = vi.fn()
    const ledgerHandle = {
      managed_prs: { toArray: [], insert: ledgerInsert },
    }
    const observe = vi.fn().mockResolvedValue(ledgerHandle)

    const ctx = {
      args: { repo: `foo/bar` },
      events: [
        { type: `inbox.user_message`, value: { content: `{"kind":"scan"}` } },
      ],
      firstWake: false,
      observe,
      spawn,
      mkdb: () => ledgerHandle,
      useAgent: vi.fn(),
      agent: { run: vi.fn() },
      timelineMessages: () => [],
      db: { collections: { inbox: { toArray: [] } } } as any,
      send: vi.fn(),
      setTag: vi.fn(),
    } as any
    const def = registry.get(`pr-watcher`)!
    await def.definition.handler(ctx, {} as any)
    expect(spawn).toHaveBeenCalledWith(
      `pr-manager`,
      expect.stringContaining(`42`),
      expect.objectContaining({ repo: `foo/bar`, number: 42 }),
      expect.any(Object)
    )
    expect(ledgerInsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: `42`, state: `active` })
    )
  })

  it(`does not respawn a pr-manager that is already in the ledger as active`, async () => {
    const registry = createEntityRegistry()
    const modelCatalog = await createBuiltinModelCatalog({
      allowMockFallback: true,
    })
    const fetchPrs = vi
      .fn()
      .mockResolvedValue([
        { number: 42, head_branch: `feat`, labels: [`agents`] },
      ])
    registerPrWatcher(registry, {
      workingDirectory: `/tmp`,
      modelCatalog: modelCatalog!,
      fetchPrs,
    })
    const spawn = vi.fn()
    const ledgerHandle = {
      managed_prs: {
        toArray: [
          {
            key: `42`,
            number: 42,
            state: `active`,
            manager_entity_url: `u`,
            spawned_at: `t`,
          },
        ],
        insert: vi.fn(),
      },
    }
    const ctx = {
      args: { repo: `foo/bar` },
      events: [
        { type: `inbox.user_message`, value: { content: `{"kind":"scan"}` } },
      ],
      firstWake: false,
      observe: vi.fn().mockResolvedValue(ledgerHandle),
      spawn,
      mkdb: () => ledgerHandle,
      useAgent: vi.fn(),
      agent: { run: vi.fn() },
      timelineMessages: () => [],
      db: { collections: { inbox: { toArray: [] } } } as any,
      send: vi.fn(),
      setTag: vi.fn(),
    } as any
    await registry.get(`pr-watcher`)!.definition.handler(ctx, {} as any)
    expect(spawn).not.toHaveBeenCalled()
  })
})
