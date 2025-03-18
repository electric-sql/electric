import {
  ControlMessage,
  Message,
  ShapeStream,
  ShapeStreamOptions,
} from '@electric-sql/client'
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import sqlite3InitModule, { Database } from '@sqlite.org/sqlite-wasm'
import { sqliteWasmWrapper } from '../src/wrapper/sqlite-wasm'
import { electricSync } from '../src/sync'
import { ElectricSync } from '../src/types'
import { SqliteWrapper } from '../src'

vi.mock(`@electric-sql/client`, async (importOriginal) => {
  const mod = await importOriginal<typeof import('@electric-sql/client')>()
  const ShapeStream = vi.fn(() => ({
    subscribe: vi.fn(),
  }))
  return { ...mod, ShapeStream }
})

const upToDateMsg: ControlMessage = {
  headers: { control: `up-to-date` },
}

describe(`sqlite-sync`, async () => {
  const sqlite3 = await sqlite3InitModule({
    print: console.log,
    printErr: console.error,
  })

  let sqliteDb: Database
  let db: ElectricSync
  let sqliteWrapped: SqliteWrapper

  const MockShapeStream = ShapeStream as unknown as Mock

  beforeEach(async () => {
    sqliteDb = new sqlite3.oo1.DB(`/mydb.sqlite3`, `c`)
    sqliteWrapped = sqliteWasmWrapper(sqliteDb)

    db = electricSync({ db: sqliteWrapped, options: { debug: false } })

    await db.exec(`
        CREATE TABLE IF NOT EXISTS todo (
          id SERIAL PRIMARY KEY,
          task TEXT,
          done BOOLEAN
        );
      `)

    await db.exec(`DELETE FROM todo;`)
  })

  it(`handles inserts/updates/deletes`, async () => {
    let feedMessage: (message: Message) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessage = (message) => cb([message, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    // Spy on the transaction method
    const transactionSpy = vi.spyOn(sqliteWrapped, `transaction`)

    const shape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      shapeKey: null,
    })

    // insert
    await feedMessage({
      headers: { operation: `insert` },
      key: `id1`,
      value: {
        id: 1,
        task: `task1`,
        done: 0,
      },
    })

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT* FROM todo;`).all()).toEqual([
        {
          id: 1,
          task: `task1`,
          done: 0,
        },
      ])
    })

    // update
    await feedMessage({
      headers: { operation: `update` },
      key: `id1`,
      value: {
        id: 1,
        task: `task2`,
        done: 1,
      },
    })

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT* FROM todo;`).all()).toEqual([
        {
          id: 1,
          task: `task2`,
          done: 1,
        },
      ])
    })

    // delete
    await feedMessage({
      headers: { operation: `delete` },
      key: `id1`,
      value: {
        id: 1,
        task: `task2`,
        done: true,
      },
    })

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT* FROM todo;`).all()).toEqual([])
    })

    expect(transactionSpy).toHaveBeenCalledTimes(3)

    shape.unsubscribe()
  })

  it(`performs operations within a transaction`, async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    // Spy on the transaction method
    const transactionSpy = vi.spyOn(sqliteWrapped, `transaction`)

    const shape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      shapeKey: null,
    })

    const numInserts = 2
    const numBatches = 1
    for (let i = 0; i < numBatches; i++) {
      const numBatchInserts = numInserts / numBatches
      await feedMessages(
        Array.from({ length: numBatchInserts }, (_, idx) => {
          const itemIdx = i * numBatchInserts + idx
          return {
            headers: { operation: `insert` },
            offset: `1_${itemIdx}`,
            key: `id${itemIdx}`,
            value: {
              id: itemIdx,
              task: `task${itemIdx}`,
              done: false,
            },
          }
        })
      )
    }

    // let timeToProcessMicrotask = Infinity
    // const startTime = performance.now()
    // Promise.resolve().then(() => {
    //   timeToProcessMicrotask = performance.now() - startTime
    // })

    let numItemsInserted = 0
    await vi.waitUntil(async () => {
      try {
        await db.mutex.acquire()
        numItemsInserted =
          (
            await db
              .prepare(`SELECT count(*) as count FROM todo;`)
              .get<{ count: number }>()
          )?.count ?? 0
      } finally {
        db.mutex.release()
      }
      return numItemsInserted > 0
    })

    // should have exact number of inserts added transactionally
    expect(numItemsInserted).toBe(numInserts)
    expect(transactionSpy).toHaveBeenCalledTimes(1)

    // should have processed microtask within few ms, not blocking main loop
    // expect(timeToProcessMicrotask).toBeLessThan(15) // TODO: flaky on CI

    shape.unsubscribe()
  })

  it(`persists shape stream state and automatically resumes`, async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    const shapeStreamInits = vi.fn()
    let mockShapeId: string | void = undefined
    MockShapeStream.mockImplementation((initOpts: ShapeStreamOptions) => {
      shapeStreamInits(initOpts)
      return {
        subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
          feedMessages = (messages) => {
            mockShapeId ??= Math.random() + ``
            return cb([...messages, upToDateMsg])
          }
        }),
        unsubscribeAll: vi.fn(),
        get shapeId() {
          return mockShapeId
        },
      }
    })

    let totalRowCount = 0
    const numInserts = 100
    const shapeIds: string[] = []

    const numResumes = 3
    for (let i = 0; i < numResumes; i++) {
      const shape = await db.electric.syncShapeToTable({
        shape: {
          url: `http://localhost:3000/v1/shape`,
          params: { table: `todo` },
        },
        table: `todo`,
        primaryKey: [`id`],
        shapeKey: `foo`,
      })

      await feedMessages(
        Array.from({ length: numInserts }, (_, idx) => ({
          headers: { operation: `insert` },
          offset: `1_${i * numInserts + idx}`,
          key: `id${i * numInserts + idx}`,
          value: {
            id: i * numInserts + idx,
            task: `task${idx}`,
            done: false,
          },
        }))
      )

      await vi.waitUntil(async () => {
        try {
          await db.mutex.acquire()
          const result = await db
            .prepare(`SELECT COUNT(*) as count FROM todo;`)
            .get<{ count: number }>()

          if (result && result.count > totalRowCount) {
            totalRowCount = result!.count
            return true
          }
          return false
        } finally {
          db.mutex.release()
        }
      })
      shapeIds.push(mockShapeId!)

      expect(shapeStreamInits).toHaveBeenCalledTimes(i + 1)
      if (i === 0) {
        expect(shapeStreamInits.mock.calls[i][0]).not.toHaveProperty(`shapeId`)
        expect(shapeStreamInits.mock.calls[i][0]).not.toHaveProperty(`offset`)
      }

      shape.unsubscribe()
    }
  })

  it(`clears and restarts persisted shape stream state on refetch`, async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    const shapeStreamInits = vi.fn()
    let mockShapeId: string | void = undefined
    MockShapeStream.mockImplementation((initOpts: ShapeStreamOptions) => {
      shapeStreamInits(initOpts)

      return {
        subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
          feedMessages = (messages) => {
            mockShapeId ??= Math.random() + ``
            if (messages.find((m) => m.headers.control === `must-refetch`)) {
              mockShapeId = undefined
            }

            return cb([...messages, upToDateMsg])
          }
        }),
        unsubscribeAll: vi.fn(),
        get shapeId() {
          return mockShapeId
        },
      }
    })

    const numInserts = 100
    const shape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      shapeKey: `foo`,
    })

    await feedMessages(
      Array.from({ length: numInserts }, (_, idx) => ({
        headers: { operation: `insert` },
        offset: `1_${idx}`,
        key: `id${idx}`,
        value: {
          id: idx,
          task: `task${idx}`,
          done: false,
        },
      }))
    )

    await vi.waitUntil(async () => {
      try {
        await db.mutex.acquire()
        const result = await db
          .prepare(`SELECT COUNT(*) as count FROM todo;`)
          .get<{ count: number }>()
        return result?.count === numInserts
      } finally {
        db.mutex.release()
      }
    })

    // feed a must-refetch message that should clear the table
    // and any aggregated messages
    await feedMessages([
      {
        headers: { operation: `insert` },
        key: `id${numInserts}`,
        value: {
          id: numInserts,
          task: `task`,
          done: false,
        },
      },
      { headers: { control: `must-refetch` } },
      {
        headers: { operation: `insert` },
        key: `id21`,
        value: {
          id: 21,
          task: `task`,
          done: false,
        },
      },
    ])

    await db.mutex.runExclusive(async () => {
      const result = await db.prepare(`SELECT * FROM todo;`).all()
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 21,
        done: 0,
        task: `task`,
      })
    })

    shape.unsubscribe()

    // resuming should
    const resumedShape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      shapeKey: `foo`,
    })
    resumedShape.unsubscribe()

    expect(shapeStreamInits).toHaveBeenCalledTimes(2)

    expect(shapeStreamInits.mock.calls[1][0]).not.toHaveProperty(`shapeId`)
    expect(shapeStreamInits.mock.calls[1][0]).not.toHaveProperty(`offset`)
  })

  it(`forbids multiple subscriptions to the same table`, async () => {
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(),
      unsubscribeAll: vi.fn(),
    }))

    const table = `foo`
    const altTable = `bar`

    const shape1 = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: table,
      primaryKey: [`id`],
      shapeKey: null,
    })

    // should throw if syncing more shapes into same table
    await expect(
      async () =>
        await db.electric.syncShapeToTable({
          shape: {
            url: `http://localhost:3000/v1/shape`,
            params: { table: `todo_alt` },
          },
          table: table,
          primaryKey: [`id`],
          shapeKey: null,
        })
    ).rejects.toThrowError(`Already syncing shape for table ${table}`)

    // should be able to sync shape into other table
    const altShape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `bar` },
      },
      table: altTable,
      primaryKey: [`id`],
      shapeKey: null,
    })
    altShape.unsubscribe()

    // should be able to sync different shape if previous is unsubscribed
    // (and we assume data has been cleaned up?)
    shape1.unsubscribe()

    const shape2 = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo_alt` },
      },
      table: table,
      primaryKey: [`id`],
      shapeKey: null,
    })
    shape2.unsubscribe()
  })

  it(`handles an update message with no columns to update`, async () => {
    let feedMessage: (message: Message) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessage = (message) => cb([message, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    // Spy on the transaction method
    const transactionSpy = vi.spyOn(sqliteWrapped, `transaction`)

    const shape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      shapeKey: null,
    })

    // insert
    await feedMessage({
      headers: { operation: `insert` },
      key: `id1`,
      value: {
        id: 1,
        task: `task1`,
        done: false,
      },
    })

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT* FROM todo;`).all()).toEqual([
        {
          id: 1,
          task: `task1`,
          done: 0,
        },
      ])
    })

    // update with no columns to update
    await feedMessage({
      headers: { operation: `update` },
      key: `id1`,
      value: {
        id: 1,
      },
    })

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT* FROM todo;`).all()).toEqual([
        {
          id: 1,
          task: `task1`,
          done: 0,
        },
      ])
    })

    expect(transactionSpy).toHaveBeenCalledTimes(2)

    shape.unsubscribe()
  })

  it(`respects numeric batch commit granularity settings`, async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    // Spy on the transaction method
    const transactionSpy = vi.spyOn(sqliteWrapped, `transaction`)

    const batchSize = 5
    const shape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      commitGranularity: batchSize,
      shapeKey: null,
    })

    // Create test messages - 7 total (should see batch of 5, then 2)
    const messages = Array.from(
      { length: 7 },
      (_, idx) =>
        ({
          headers: { operation: `insert` },
          key: `id${idx}`,
          value: {
            id: idx,
            task: `task${idx}`,
            done: false,
          },
        }) satisfies Message
    )

    await feedMessages(messages)

    // Wait for all inserts to complete
    await vi.waitUntil(async () => {
      try {
        await db.mutex.acquire()
        const result = await db
          .prepare(
            `
          SELECT COUNT(*) as count FROM todo;
        `
          )
          .get<{ count: number }>()
        return result?.count === 7
      } finally {
        db.mutex.release()
      }
    })

    // Verify all rows were inserted
    await db.mutex.runExclusive(async () => {
      const result = await db
        .prepare(
          `
        SELECT * FROM todo ORDER BY id;
      `
        )
        .all<{ count: number }>()
      expect(result).toEqual(
        messages.map((m) => ({
          id: m.value.id,
          task: m.value.task,
          done: 0,
        }))
      )
    })

    // Verify transaction() was called exactly twice
    expect(transactionSpy).toHaveBeenCalledTimes(2)

    shape.unsubscribe()
  })

  it(`respects up-to-date commit granularity settings`, async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    // Spy on the transaction method
    const transactionSpy = vi.spyOn(sqliteWrapped, `transaction`)

    const shape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      commitGranularity: `up-to-date`,
      shapeKey: null,
    })

    // Send multiple messages
    await feedMessages([
      {
        headers: { operation: `insert` },
        key: `id1`,
        value: { id: 1, task: `task1`, done: false },
      },
      {
        headers: { operation: `insert` },
        key: `id2`,
        value: { id: 2, task: `task2`, done: false },
      },
      {
        headers: { operation: `insert` },
        key: `id3`,
        value: { id: 3, task: `task3`, done: false },
      },
    ])

    // Wait for all inserts to complete
    await vi.waitUntil(async () => {
      try {
        await db.mutex.acquire()
        const result = await db
          .prepare(`SELECT COUNT(*) as count FROM todo;`)
          .get<{ count: number }>()
        return result?.count === 3
      } finally {
        db.mutex.release()
      }
    })

    // Should have received only one commit notification since all operations
    // were included in a single transaction when using 'up-to-date' setting
    expect(transactionSpy).toHaveBeenCalledTimes(1)

    shape.unsubscribe()
  })
})
