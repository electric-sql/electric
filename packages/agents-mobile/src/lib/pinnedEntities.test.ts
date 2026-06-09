import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  map: new Map<string, string>(),
  // When set, getItem blocks until the promise resolves — lets tests
  // hold the hydration IIFE open to exercise the pre-hydration path.
  gate: null as Promise<void> | null,
}))

vi.mock(`@react-native-async-storage/async-storage`, () => ({
  default: {
    getItem: vi.fn(async (key: string) => {
      // Snapshot at call time (real AsyncStorage serializes FIFO, so a
      // getItem issued before a setItem sees the pre-write value), then
      // optionally block on the gate before resolving.
      const value = store.map.get(key) ?? null
      if (store.gate) await store.gate
      return value
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      store.map.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      store.map.delete(key)
    }),
  },
}))

const STORAGE_KEY = `electric-agents-mobile.pinned-entities`

// Re-import the module fresh each test so its module-level state + the
// import-time hydration IIFE re-run against the current mock storage.
async function freshModule() {
  vi.resetModules()
  const mod = await import(`./pinnedEntities`)
  // Let the async hydration IIFE settle.
  await new Promise((resolve) => setTimeout(resolve, 0))
  return mod
}

beforeEach(() => {
  store.map.clear()
  store.gate = null
  vi.clearAllMocks()
})

describe(`pinnedEntities`, () => {
  it(`togglePin adds a url and exposes it via the snapshot`, async () => {
    const { togglePin, getPinnedUrls } = await freshModule()
    togglePin(`/horton/one`)
    togglePin(`/horton/two`)
    expect(getPinnedUrls()).toEqual([`/horton/one`, `/horton/two`])
  })

  it(`toggling the same url twice removes it`, async () => {
    const { togglePin, getPinnedUrls } = await freshModule()
    togglePin(`/horton/one`)
    togglePin(`/horton/two`)
    togglePin(`/horton/one`)
    expect(getPinnedUrls()).toEqual([`/horton/two`])
  })

  it(`persists to AsyncStorage and rehydrates on next load`, async () => {
    const first = await freshModule()
    first.togglePin(`/horton/one`)
    first.togglePin(`/horton/two`)
    expect(store.map.get(STORAGE_KEY)).toBe(
      JSON.stringify([`/horton/one`, `/horton/two`])
    )

    // A fresh module instance should hydrate from the persisted blob.
    const second = await freshModule()
    expect(second.getPinnedUrls()).toEqual([`/horton/one`, `/horton/two`])
  })

  it(`merges (does not clobber) when a toggle lands before hydration`, async () => {
    // Persist a pin, then hold hydration open with the gate so a toggle
    // genuinely lands during the startup hydration window.
    store.map.set(STORAGE_KEY, JSON.stringify([`/horton/persisted`]))
    let release!: () => void
    store.gate = new Promise((resolve) => {
      release = resolve
    })
    vi.resetModules()
    const mod = await import(`./pinnedEntities`)
    mod.togglePin(`/horton/early`)
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Both the persisted pin and the pre-hydration pin survive.
    expect(mod.getPinnedUrls()).toEqual([`/horton/persisted`, `/horton/early`])
  })

  it(`pre-hydration pin of an already-persisted url does not duplicate it`, async () => {
    store.map.set(
      STORAGE_KEY,
      JSON.stringify([`/horton/persisted`, `/horton/other`])
    )
    let release!: () => void
    store.gate = new Promise((resolve) => {
      release = resolve
    })
    vi.resetModules()
    const mod = await import(`./pinnedEntities`)
    // The pre-hydration set is empty, so this toggle *pins* — the merge
    // must not resurrect it as a duplicate once the persisted set lands.
    mod.togglePin(`/horton/persisted`)
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mod.getPinnedUrls()).toEqual([`/horton/persisted`, `/horton/other`])
  })

  it(`ignores malformed persisted payloads`, async () => {
    store.map.set(
      STORAGE_KEY,
      JSON.stringify([`/horton/one`, 42, null, { url: `/x` }, `/horton/two`])
    )
    const { getPinnedUrls } = await freshModule()
    expect(getPinnedUrls()).toEqual([`/horton/one`, `/horton/two`])
  })

  it(`ignores a non-array persisted payload`, async () => {
    store.map.set(STORAGE_KEY, JSON.stringify({ not: `an array` }))
    const { getPinnedUrls } = await freshModule()
    expect(getPinnedUrls()).toEqual([])
  })
})
