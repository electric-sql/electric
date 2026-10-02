import { describe, expect, it, vi } from 'vitest'
import { WakeRegistry } from '../src/wake-registry'

const { shapeStreamState } = vi.hoisted(() => ({
  shapeStreamState: {
    latest: null as null | {
      emit: (messages: Array<Record<string, unknown>>) => Promise<void>
      signal?: AbortSignal
    },
  },
}))

vi.mock(`@electric-sql/client`, () => ({
  isControlMessage: (message: { headers?: Record<string, unknown> }) =>
    typeof message.headers?.control === `string`,
  isChangeMessage: (message: { headers?: Record<string, unknown> }) =>
    typeof message.headers?.operation === `string`,
  ShapeStream: class MockShapeStream {
    private onMessages:
      | ((messages: Array<Record<string, unknown>>) => Promise<void> | void)
      | null = null

    constructor(options: { signal?: AbortSignal }) {
      shapeStreamState.latest = {
        signal: options.signal,
        emit: async (messages) => {
          await this.onMessages?.(messages)
        },
      }
    }

    subscribe(
      callback: (messages: Array<Record<string, unknown>>) => Promise<void>,
      _onError?: (error: Error) => void
    ): () => void {
      this.onMessages = callback
      return () => {
        this.onMessages = null
      }
    }
  },
}))

function createMockDb(): any {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([{ id: 1 }]),
        }),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: () => Promise.resolve([]),
    }),
  }
}

type WakeRegistrationShapeRowLike = Record<string, unknown>

describe(`WakeRegistry Electric sync`, () => {
  it(`ignores malformed shape messages without headers while waiting for up-to-date`, async () => {
    const registry = new WakeRegistry(createMockDb())

    const startPromise = registry.startSync(`http://electric.test`)

    await expect(
      shapeStreamState.latest!.emit([
        {
          key: `ignored-malformed-message`,
        },
        {
          headers: {
            control: `up-to-date`,
          },
        },
      ])
    ).resolves.toBeUndefined()

    await expect(startPromise).resolves.toBeUndefined()

    await registry.stopSync()
  })

  it(`a delete carrying the row in value removes only that registration`, async () => {
    const registry = new WakeRegistry(createMockDb())
    const startPromise = registry.startSync(`http://electric.test`)
    const row = (id: number, source: string) => ({
      id,
      subscriber_url: `/parent/p1`,
      source_url: source,
      condition: `runFinished` as const,
      debounce_ms: 0,
      timeout_ms: 0,
      one_shot: false,
      timeout_consumed: false,
      include_response: true,
      manifest_key: `child:${source}`,
      created_at: new Date(),
    })
    const runFinished = (key: string) => ({
      type: `run`,
      key,
      value: { status: `completed` },
      headers: { operation: `update` },
    })
    await shapeStreamState.latest!.emit([
      {
        key: `1`,
        value: row(1, `/child/c1`),
        headers: { operation: `insert` },
      },
      {
        key: `2`,
        value: row(2, `/child/c2`),
        headers: { operation: `insert` },
      },
      { headers: { control: `up-to-date` } },
    ])
    await startPromise

    // Electric's `replica: full` delete message carries the deleted row in
    // `value`, not `old_value` (measured against electricsql/electric 1.7.10).
    await shapeStreamState.latest!.emit([
      {
        key: `1`,
        value: row(1, `/child/c1`) as unknown as WakeRegistrationShapeRowLike,
        headers: { operation: `delete` },
      },
    ])

    expect(registry.evaluate(`/child/c1`, runFinished(`run-1`))).toHaveLength(0)
    expect(registry.evaluate(`/child/c2`, runFinished(`run-1`))).toHaveLength(1)
    await registry.stopSync()
  })

  it(`hydrates and updates the cache from shape changes`, async () => {
    const registry = new WakeRegistry(createMockDb())

    const startPromise = registry.startSync(`http://electric.test`)

    await shapeStreamState.latest!.emit([
      {
        key: `1`,
        value: {
          id: 1,
          subscriber_url: `/parent/p1`,
          source_url: `/child/c1`,
          condition: `runFinished`,
          debounce_ms: 0,
          timeout_ms: 0,
          one_shot: false,
          timeout_consumed: false,
          include_response: true,
          manifest_key: null,
          created_at: new Date(),
        },
        headers: {
          operation: `insert`,
        },
      },
      {
        headers: {
          control: `up-to-date`,
        },
      },
    ])

    await startPromise

    expect(
      registry.evaluate(`/child/c1`, {
        type: `run`,
        key: `run-1`,
        value: { status: `completed` },
        headers: { operation: `update` },
      })
    ).toHaveLength(1)

    await shapeStreamState.latest!.emit([
      {
        key: `1`,
        headers: {
          operation: `delete`,
        },
      },
    ])

    expect(
      registry.evaluate(`/child/c1`, {
        type: `run`,
        key: `run-2`,
        value: { status: `completed` },
        headers: { operation: `update` },
      })
    ).toHaveLength(0)

    await registry.stopSync()
    expect(shapeStreamState.latest!.signal?.aborted).toBe(true)
  })
})
