import { describe, expect, it, vi } from 'vitest'
import { startStandaloneAgentsRuntime } from '../src/standalone-runtime'

function createEntityBridgeManagerMock() {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    register: vi.fn(async () => ({
      sourceRef: `test`,
      streamUrl: `/_entities/test`,
    })),
    onEntityChanged: vi.fn(async () => undefined),
    touchByStreamPath: vi.fn(async () => undefined),
    beginClientRead: vi.fn(async () => null),
  }
}

describe(`standalone runtime pg-sync startup/shutdown`, () => {
  it(`starts pg-sync bridge manager even when entity bridge manager startup is disabled`, async () => {
    const entityBridgeManager = createEntityBridgeManagerMock()
    const pgSyncBridgeManager = {
      start: vi.fn(async () => undefined),
      register: vi.fn(),
      stop: vi.fn(async () => undefined),
    }

    const standalone = await startStandaloneAgentsRuntime({
      service: `tenant-test`,
      db: undefined as any,
      pgClient: undefined as any,
      streamClient: { baseUrl: `http://durable` } as any,
      wakeRegistry: {
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
      entityBridgeManager,
      pgSyncBridgeManager,
      startWakeRegistry: false,
      rehydrateOnStart: false,
      startScheduler: false,
      startTagStreamOutboxDrainer: false,
      startEntityBridgeManager: false,
    })

    expect(entityBridgeManager.start).not.toHaveBeenCalled()
    expect(pgSyncBridgeManager.start).toHaveBeenCalledOnce()

    vi.spyOn(standalone.runtime.manager, `shutdown`).mockResolvedValue(
      undefined
    )
    await standalone.stop()
  })

  it(`delegates pg-sync bridge manager shutdown to runtime.stop once`, async () => {
    const pgSyncBridgeManager = {
      start: vi.fn(async () => undefined),
      register: vi.fn(),
      stop: vi.fn(async () => undefined),
    }
    const standalone = await startStandaloneAgentsRuntime({
      service: `tenant-test`,
      db: undefined as any,
      pgClient: undefined as any,
      streamClient: { baseUrl: `http://durable` } as any,
      wakeRegistry: {
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
      entityBridgeManager: createEntityBridgeManagerMock(),
      pgSyncBridgeManager,
      startWakeRegistry: false,
      rehydrateOnStart: false,
      startScheduler: false,
      startTagStreamOutboxDrainer: false,
    })
    vi.spyOn(standalone.runtime.manager, `shutdown`).mockResolvedValue(
      undefined
    )

    await standalone.stop()
    await standalone.stop()

    expect(pgSyncBridgeManager.stop).toHaveBeenCalledOnce()
  })
})
