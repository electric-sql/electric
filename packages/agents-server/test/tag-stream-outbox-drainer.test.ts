import { describe, expect, it, vi } from 'vitest'
import { TagStreamOutboxDrainer } from '../src/tag-stream-outbox-drainer'
import { UnregisteredTenantError } from '../src/tenant'

describe(`TagStreamOutboxDrainer`, () => {
  it(`marks failed rows and keeps their claims releasable`, async () => {
    const registry = {
      claimTagOutboxRows: vi.fn().mockResolvedValue([
        {
          id: 7,
          tenantId: `default`,
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
      10,
      `default`
    )
    expect(registry.deleteTagOutboxRow).not.toHaveBeenCalled()
    expect(registry.releaseTagOutboxClaims).toHaveBeenCalledWith(
      expect.any(String),
      `default`
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
          tenantId: `default`,
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

    expect(registry.deleteTagOutboxRow).toHaveBeenCalledWith(9, `default`)
    expect(registry.releaseTagOutboxClaims).toHaveBeenCalledWith(
      expect.any(String),
      `default`
    )
  })

  it(`filters shared claims to registered tenant ids`, async () => {
    const registry = {
      claimTagOutboxRows: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 11,
            tenantId: `svc-a`,
            entityUrl: `/task/demo`,
            collection: `tags`,
            op: `insert`,
            key: `title`,
            rowData: { key: `title`, value: `hello` },
            attemptCount: 0,
            createdAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([]),
      failTagOutboxRow: vi.fn().mockResolvedValue({
        attemptCount: 1,
        deadLettered: false,
      }),
      deleteTagOutboxRow: vi.fn().mockResolvedValue(undefined),
      releaseTagOutboxClaims: vi.fn().mockResolvedValue(undefined),
    }
    const streamClient = {
      appendWithProducerHeaders: vi.fn().mockResolvedValue(undefined),
    }

    const drainer = new TagStreamOutboxDrainer(
      registry as never,
      streamClient as never,
      { tenantId: null, tenantIds: () => [`svc-a`, `svc-b`] }
    )

    await drainer.drainOnce()

    expect(registry.claimTagOutboxRows).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      25,
      `svc-a`
    )
    expect(registry.claimTagOutboxRows).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      24,
      `svc-b`
    )
    expect(registry.deleteTagOutboxRow).toHaveBeenCalledWith(11, `svc-a`)
  })

  it(`soft-skips rows for tenants missing during publish`, async () => {
    const registry = {
      claimTagOutboxRows: vi.fn().mockResolvedValue([
        {
          id: 13,
          tenantId: `svc-missing`,
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
    const resolveStreamClient = vi
      .fn()
      .mockRejectedValue(new UnregisteredTenantError(`svc-missing`, `test`))

    const drainer = new TagStreamOutboxDrainer(
      registry as never,
      resolveStreamClient
    )

    await drainer.drainOnce()

    expect(resolveStreamClient).toHaveBeenCalledWith(`svc-missing`)
    expect(registry.failTagOutboxRow).not.toHaveBeenCalled()
    expect(registry.deleteTagOutboxRow).not.toHaveBeenCalled()
    expect(registry.releaseTagOutboxClaims).toHaveBeenCalledWith(
      expect.any(String),
      `svc-missing`
    )
  })
})
