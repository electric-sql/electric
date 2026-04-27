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

describe(`WakeRegistry Electric sync`, () => {
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
