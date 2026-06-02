import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedServer } from './savedServers'

const store = vi.hoisted(() => ({ map: new Map<string, string>() }))

vi.mock(`@react-native-async-storage/async-storage`, () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.map.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.map.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      store.map.delete(key)
    }),
  },
}))

const STORAGE_KEY = `electric-agents-mobile.servers`

const manual: SavedServer = {
  id: `https://self.example/v1`,
  name: `self.example`,
  url: `https://self.example/v1`,
  source: `manual`,
}
const cloud: SavedServer = {
  id: `svc-123`,
  name: `Prod`,
  url: `https://agents.electric-sql.cloud/t/svc-123/v1`,
  source: `electric-cloud`,
}

// Re-import the module fresh each test so its module-level state + the
// import-time hydration IIFE re-run against the current mock storage.
async function freshModule() {
  vi.resetModules()
  const mod = await import(`./savedServers`)
  // Let the async hydration IIFE settle.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return mod
}

beforeEach(() => {
  store.map.clear()
  vi.clearAllMocks()
})

describe(`savedServers`, () => {
  it(`adds servers and exposes them via the snapshot`, async () => {
    const { addSavedServer, getSavedServers } = await freshModule()
    addSavedServer(manual)
    addSavedServer(cloud)
    expect(getSavedServers()).toEqual([manual, cloud])
  })

  it(`upserts by URL instead of duplicating`, async () => {
    const { addSavedServer, getSavedServers } = await freshModule()
    addSavedServer(manual)
    addSavedServer({ ...manual, name: `renamed` })
    expect(getSavedServers()).toEqual([{ ...manual, name: `renamed` }])
  })

  it(`removes a server by id`, async () => {
    const { addSavedServer, removeSavedServerById, getSavedServers } =
      await freshModule()
    addSavedServer(manual)
    addSavedServer(cloud)
    removeSavedServerById(cloud.id)
    expect(getSavedServers()).toEqual([manual])
  })

  it(`removeCloudSavedServers drops only electric-cloud entries`, async () => {
    const { addSavedServer, removeCloudSavedServers, getSavedServers } =
      await freshModule()
    addSavedServer(manual)
    addSavedServer(cloud)
    removeCloudSavedServers()
    expect(getSavedServers()).toEqual([manual])
  })

  it(`persists to AsyncStorage and rehydrates on next load`, async () => {
    const first = await freshModule()
    first.addSavedServer(manual)
    first.addSavedServer(cloud)
    expect(store.map.get(STORAGE_KEY)).toBe(JSON.stringify([manual, cloud]))

    // A fresh module instance should hydrate from the persisted blob.
    const second = await freshModule()
    expect(second.getSavedServers()).toEqual([manual, cloud])
  })

  it(`merges (does not clobber) when a mutation lands before hydration`, async () => {
    // Persist a server, then simulate a fresh load where a mutation (e.g.
    // the active-server migration) happens before hydration resolves.
    store.map.set(STORAGE_KEY, JSON.stringify([cloud]))
    vi.resetModules()
    const mod = await import(`./savedServers`)
    // Mutate synchronously, before the hydration IIFE's await settles.
    mod.addSavedServer(manual)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Both the persisted cloud server and the pre-hydration manual server
    // survive (deduped by URL).
    expect(mod.getSavedServers()).toEqual([cloud, manual])
  })

  it(`ignores malformed persisted entries`, async () => {
    store.map.set(
      STORAGE_KEY,
      JSON.stringify([manual, { id: `x` }, { foo: `bar` }, cloud])
    )
    const { getSavedServers } = await freshModule()
    expect(getSavedServers()).toEqual([manual, cloud])
  })
})
