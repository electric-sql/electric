import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsManager } from '../src/electric-agents-manager'

describe(`ElectricAgentsManager kill dispatch cleanup`, () => {
  it(`supersedes dispatch state when stopping an entity`, async () => {
    const registry = {
      getEntity: vi.fn().mockResolvedValue({
        url: `/chat/stopped`,
        type: `chat`,
        status: `idle`,
        streams: {
          main: `/chat/stopped/main`,
          error: `/chat/stopped/error`,
        },
        subscription_id: `chat-handler`,
        write_token: `write-secret`,
        tags: {},
        created_at: 0,
        updated_at: 0,
      }),
      updateStatusWithTxid: vi.fn().mockResolvedValue(42),
      supersedeDispatchForStoppedEntity: vi.fn().mockResolvedValue({
        matched: true,
        clearedPendingSourceStreams: [],
      }),
    }
    const wakeRegistry = {
      setTimeoutCallback: vi.fn(),
      setDebounceCallback: vi.fn(),
      unregisterBySubscriber: vi.fn().mockResolvedValue(undefined),
      unregisterBySource: vi.fn().mockResolvedValue(undefined),
    }
    const streamClient = {
      append: vi.fn().mockResolvedValue({}),
    }
    const validator = {}

    const manager = new ElectricAgentsManager({
      registry: registry as any,
      streamClient: streamClient as any,
      validator: validator as any,
      wakeRegistry: wakeRegistry as any,
    })

    await expect(manager.kill(`/chat/stopped`)).resolves.toEqual({ txid: 42 })

    expect(wakeRegistry.unregisterBySubscriber).toHaveBeenCalledWith(
      `/chat/stopped`
    )
    expect(wakeRegistry.unregisterBySource).toHaveBeenCalledWith(
      `/chat/stopped`
    )
    expect(registry.updateStatusWithTxid).toHaveBeenCalledWith(
      `/chat/stopped`,
      `stopped`
    )
    expect(registry.supersedeDispatchForStoppedEntity).toHaveBeenCalledWith({
      entityUrl: `/chat/stopped`,
    })
    expect(streamClient.append).toHaveBeenCalledWith(
      `/chat/stopped/main`,
      expect.any(Uint8Array),
      { close: true }
    )
    expect(streamClient.append).toHaveBeenCalledWith(
      `/chat/stopped/error`,
      expect.any(Uint8Array),
      { close: true }
    )
  })
})
