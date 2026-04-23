import { describe, expect, it, vi } from 'vitest'
import { TagStreamOutboxDrainer } from '../src/tag-stream-outbox-drainer'

describe(`TagStreamOutboxDrainer`, () => {
  it(`marks failed rows and keeps their claims releasable`, async () => {
    const registry = {
      claimTagOutboxRows: vi.fn().mockResolvedValue([
        {
          id: 7,
          entityUrl: `/task/demo`,
          collection: `tags`,
          op: `insert`,
          key: `title`,
          rowData: { key: `title`, value: `hello` },
          attemptCount: 0,
          createdAt: new Date(),
        },
      ]),
      failTagOutboxRow: vi.fn().mockResolvedValue({
        attemptCount: 1,
        deadLettered: false,
      }),
      deleteTagOutboxRow: vi.fn().mockResolvedValue(undefined),
      releaseTagOutboxClaims: vi.fn().mockResolvedValue(undefined),
    }

    const streamClient = {
      appendWithProducerHeaders: vi.fn().mockRejectedValue(new Error(`boom`)),
    }

    const drainer = new TagStreamOutboxDrainer(
      registry as never,
      streamClient as never
    )

    await drainer.drainOnce()
    await drainer.stop()

    expect(registry.failTagOutboxRow).toHaveBeenCalledWith(
      7,
      expect.any(String),
      `boom`,
      10
    )
    expect(registry.deleteTagOutboxRow).not.toHaveBeenCalled()
    expect(registry.releaseTagOutboxClaims).toHaveBeenCalledWith(
      expect.any(String)
    )
  })

  it(`waits for an active drain before releasing claims on stop`, async () => {
    let resolveAppend = () => {}
    const appendPromise = new Promise<void>((resolve) => {
      resolveAppend = resolve
    })

    const registry = {
      claimTagOutboxRows: vi.fn().mockResolvedValue([
        {
          id: 9,
          entityUrl: `/task/demo`,
          collection: `tags`,
          op: `insert`,
          key: `title`,
          rowData: { key: `title`, value: `hello` },
          attemptCount: 0,
          createdAt: new Date(),
        },
      ]),
      failTagOutboxRow: vi.fn().mockResolvedValue({
        attemptCount: 1,
        deadLettered: false,
      }),
      deleteTagOutboxRow: vi.fn().mockResolvedValue(undefined),
      releaseTagOutboxClaims: vi.fn().mockResolvedValue(undefined),
    }

    const streamClient = {
      appendWithProducerHeaders: vi
        .fn()
        .mockImplementation(() => appendPromise),
    }

    const drainer = new TagStreamOutboxDrainer(
      registry as never,
      streamClient as never
    )

    const drainPromise = drainer.drainOnce()
    await Promise.resolve()

    const stopPromise = drainer.stop()
    expect(registry.releaseTagOutboxClaims).not.toHaveBeenCalled()

    resolveAppend()
    await drainPromise
    await stopPromise

    expect(registry.deleteTagOutboxRow).toHaveBeenCalledWith(9)
    expect(registry.releaseTagOutboxClaims).toHaveBeenCalledWith(
      expect.any(String)
    )
  })
})
