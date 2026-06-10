import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsTenantRuntime } from '../src/runtime'

describe(`ElectricAgentsTenantRuntime shutdown`, () => {
  it(`stops the pg-sync bridge manager`, async () => {
    const pgSyncBridgeManager = {
      start: vi.fn(async () => undefined),
      register: vi.fn(),
      stop: vi.fn(async () => undefined),
    }
    const runtime = new ElectricAgentsTenantRuntime({
      service: `tenant-test`,
      db: undefined as any,
      streamClient: { baseUrl: `http://durable` } as any,
      wakeRegistry: {
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
      scheduler: undefined as any,
      entityBridgeManager: undefined as any,
      pgSyncBridgeManager,
    })
    vi.spyOn(runtime.manager, `shutdown`).mockResolvedValue(undefined)

    await runtime.stop()

    expect(runtime.manager.shutdown).toHaveBeenCalledOnce()
    expect(pgSyncBridgeManager.stop).toHaveBeenCalledOnce()
  })
})
