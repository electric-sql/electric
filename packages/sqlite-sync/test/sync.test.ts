import { ShapeStreamOptions } from '@electric-sql/client'
import { MultiShapeMessages } from '@electric-sql/experimental'
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiShapeStream } from '@electric-sql/experimental'
import sqlite3InitModule, { Database } from '@sqlite.org/sqlite-wasm'
import { sqliteWasmWrapper } from '../src/wrapper/sqlite-wasm'
import { electricSync } from '../src/sync'
import { ElectricSync } from '../src/types'
import { SqliteWrapper } from '../src'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MultiShapeMessage = MultiShapeMessages<any>

vi.mock(`@electric-sql/experimental`, async (importOriginal) => {
  const mod =
    /* eslint-disable-next-line @typescript-eslint/quotes */
    await importOriginal<typeof import('@electric-sql/experimental')>()
  const MultiShapeStream = vi.fn(() => ({
    subscribe: vi.fn(),
    unsubscribeAll: vi.fn(),
    isUpToDate: true,
    shapes: {},
  }))
  return { ...mod, MultiShapeStream }
})

describe(`sqlite-sync`, async () => {
  const sqlite3 = await sqlite3InitModule({
    print: console.log,
    printErr: console.error,
  })

  let sqliteDb: Database
  let db: ElectricSync
  let sqliteWrapped: SqliteWrapper

  const MockMultiShapeStream = MultiShapeStream as unknown as Mock

  beforeEach(async () => {
    sqliteDb = new sqlite3.oo1.DB(`:memory:`, `tw`)
    sqliteWrapped = sqliteWasmWrapper(sqliteDb)

    db = electricSync({ db: sqliteWrapped, options: { debug: true } })

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
    let feedMessage: (
      lsn: number,
      message: MultiShapeMessage
    ) => Promise<void> = async (_) => {}
    MockMultiShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(
        (cb: (messages: MultiShapeMessage[]) => Promise<void>) => {
          feedMessage = (lsn, message) =>
            cb([
              message,
              {
                shape: `shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: lsn.toString(),
                },
              },
            ])
        }
      ),
      unsubscribeAll: vi.fn(),
      isUpToDate: true,
      shapes: {
        shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
      },
    }))

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
    await feedMessage(0, {
      headers: { operation: `insert`, lsn: `0` },
      key: `id1`,
      value: {
        id: 1,
        task: `task1`,
        done: false,
      },
      shape: `shape`,
    })

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT * FROM todo;`).all()).toEqual([
        {
          id: 1,
          task: `task1`,
          done: 0,
        },
      ])
    })

    // update
    await feedMessage(1, {
      headers: { operation: `update`, lsn: `1` },
      key: `id1`,
      value: {
        id: 1,
        task: `task2`,
        done: true,
      },
      shape: `shape`,
    })

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT * FROM todo;`).all()).toEqual([
        {
          id: 1,
          task: `task2`,
          done: 1,
        },
      ])
    })

    // delete
    await feedMessage(2, {
      headers: { operation: `delete`, lsn: `2` },
      key: `id1`,
      value: {
        id: 1,
        task: `task2`,
        done: true,
      },
      shape: `shape`,
    })

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT * FROM todo;`).all()).toEqual([])
    })

    shape.unsubscribe()
  })

  it(`performs operations within a transaction`, async () => {
    let feedMessages: (
      lsn: number,
      messages: MultiShapeMessage[]
    ) => Promise<void> = async (_) => {}
    MockMultiShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(
        (cb: (messages: MultiShapeMessage[]) => Promise<void>) => {
          feedMessages = (lsn, messages) =>
            cb([
              ...messages,
              {
                shape: `shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: lsn.toString(),
                },
              },
            ])
        }
      ),
      unsubscribeAll: vi.fn(),
      isUpToDate: true,
      shapes: {
        shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
      },
    }))

    const shape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      shapeKey: null,
    })

    const numInserts = 10000
    const numBatches = 5
    for (let i = 0; i < numBatches; i++) {
      const numBatchInserts = numInserts / numBatches
      await feedMessages(
        i,
        Array.from({ length: numBatchInserts }, (_, idx) => {
          const itemIdx = i * numBatchInserts + idx
          return {
            headers: { operation: `insert`, lsn: i.toString() },
            key: `id${itemIdx}`,
            value: {
              id: itemIdx,
              task: `task${itemIdx}`,
              done: false,
            },
            shape: `shape`,
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

    // should have processed microtask within few ms, not blocking main loop
    // expect(timeToProcessMicrotask).toBeLessThan(15) // TODO: flaky on CI

    shape.unsubscribe()
  })

  it(`persists shape stream state and automatically resumes`, async () => {
    let feedMessages: (
      lsn: number,
      messages: MultiShapeMessage[]
    ) => Promise<void> = async (_) => {}
    const shapeStreamInits = vi.fn()
    let mockShapeId: string | void = undefined
    MockMultiShapeStream.mockImplementation((initOpts: ShapeStreamOptions) => {
      shapeStreamInits(initOpts)
      return {
        subscribe: vi.fn(
          (cb: (messages: MultiShapeMessage[]) => Promise<void>) => {
            feedMessages = (lsn, messages) => {
              mockShapeId ??= Math.random() + ``
              return cb([
                ...messages,
                {
                  shape: `shape`,
                  headers: {
                    control: `up-to-date`,
                    global_last_seen_lsn: lsn.toString(),
                  },
                },
              ])
            }
          }
        ),
        unsubscribeAll: vi.fn(),
        isUpToDate: true,
        shapes: {
          shape: {
            subscribe: vi.fn(),
            unsubscribeAll: vi.fn(),
          },
        },
      }
    })

    let totalRowCount = 0
    const numInserts = 1 //100
    const shapeIds: string[] = []

    const numResumes = 2
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
        i,
        Array.from({ length: numInserts }, (_, idx) => ({
          headers: {
            operation: `insert`,
            lsn: i.toString(),
          },
          key: `id${i * numInserts + idx}`,
          value: {
            id: i * numInserts + idx,
            task: `task${idx}`,
            done: false,
          },
          shape: `shape`,
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
    let feedMessages: (messages: MultiShapeMessage[]) => Promise<void> = async (
      _
    ) => {}
    const shapeStreamInits = vi.fn()
    let mockShapeId: string | void = undefined
    MockMultiShapeStream.mockImplementation((initOpts: ShapeStreamOptions) => {
      shapeStreamInits(initOpts)
      return {
        subscribe: vi.fn(
          (cb: (messages: MultiShapeMessage[]) => Promise<void>) => {
            feedMessages = (messages) => {
              mockShapeId ??= Math.random() + ``
              if (messages.find((m) => m.headers.control === `must-refetch`)) {
                mockShapeId = undefined
              }

              return cb([
                ...messages,
                {
                  shape: `shape`,
                  headers: {
                    control: `up-to-date`,
                    global_last_seen_lsn: `0`,
                  },
                },
              ])
            }
          }
        ),
        unsubscribeAll: vi.fn(),
        isUpToDate: true,
        shapes: {
          shape: {
            subscribe: vi.fn(),
            unsubscribeAll: vi.fn(),
          },
        },
      }
    })

    const shape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      shapeKey: `foo`,
    })

    const numInserts = 100
    await feedMessages([
      {
        headers: { operation: `insert` },
        key: `id${numInserts}`,
        value: {
          id: numInserts,
          task: `task`,
          done: false,
        },
        shape: `shape`,
      },
      { headers: { control: `must-refetch` }, shape: `shape` },
      {
        headers: { operation: `insert` },
        key: `id21`,
        value: {
          id: 21,
          task: `task`,
          done: false,
        },
        shape: `shape`,
      },
    ])

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT * FROM todo;`).all()).toEqual([
        {
          id: 21,
          task: `task`,
          done: 0,
        },
      ])
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
    MockMultiShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(),
      unsubscribeAll: vi.fn(),
      isUpToDate: true,
      shapes: {
        shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
      },
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
    let feedMessage: (message: MultiShapeMessage) => Promise<void> = async (
      _
    ) => {}
    MockMultiShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(
        (cb: (messages: MultiShapeMessage[]) => Promise<void>) => {
          feedMessage = (message) =>
            cb([
              message,
              {
                shape: `shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: `0`,
                },
              },
            ])
        }
      ),
      unsubscribeAll: vi.fn(),
      isUpToDate: true,
      shapes: {
        shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
      },
    }))

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
      shape: `shape`,
    })

    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT * FROM todo;`).all()).toEqual([
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
      shape: `shape`,
    })
    await db.mutex.runExclusive(async () => {
      expect(await db.prepare(`SELECT * FROM todo;`).all()).toEqual([
        {
          id: 1,
          task: `task1`,
          done: 0,
        },
      ])
    })

    shape.unsubscribe()
  })

  it(`calls onInitialSync callback after initial sync`, async () => {
    let feedMessages: (
      lsn: number,
      messages: MultiShapeMessage[]
    ) => Promise<void> = async (_) => {}
    MockMultiShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(
        (cb: (messages: MultiShapeMessage[]) => Promise<void>) => {
          feedMessages = (lsn, messages) =>
            cb([
              ...messages,
              {
                shape: `shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: lsn.toString(),
                },
              },
            ])
        }
      ),
      unsubscribeAll: vi.fn(),
      isUpToDate: true,
      shapes: {
        shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
      },
    }))

    const onInitialSync = vi.fn(() => {
      console.log(`onInitialSync`)
    })
    const shape = await db.electric.syncShapeToTable({
      shape: {
        url: `http://localhost:3000/v1/shape`,
        params: { table: `todo` },
      },
      table: `todo`,
      primaryKey: [`id`],
      onInitialSync,
      shapeKey: null,
    })

    // Send some initial data
    await feedMessages(0, [
      {
        headers: { operation: `insert`, lsn: `0` },
        key: `id1`,
        value: {
          id: 1,
          task: `task1`,
          done: false,
        },
        shape: `shape`,
      },
      {
        headers: { operation: `insert`, lsn: `0` },
        key: `id2`,
        value: {
          id: 2,
          task: `task2`,
          done: true,
        },
        shape: `shape`,
      },
    ])

    // Verify callback was called once
    expect(onInitialSync).toHaveBeenCalledTimes(1)

    // Send more data - callback should not be called again
    await feedMessages(1, [
      {
        headers: { operation: `insert`, lsn: `1` },
        key: `id3`,
        value: {
          id: 3,
          task: `task3`,
          done: false,
        },
        shape: `shape`,
      },
    ])

    // Verify callback was still only called once
    expect(onInitialSync).toHaveBeenCalledTimes(1)

    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT COUNT(*) as count FROM todo;`)
          .all<{ count: number }>()
      ).toEqual([
        {
          count: 3,
        },
      ])
    })

    shape.unsubscribe()
  })

  it(`syncs multiple shapes to multiple tables simultaneously`, async () => {
    // Create a second table for testing multi-shape sync
    await db.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id SERIAL PRIMARY KEY,
        name TEXT,
        active BOOLEAN
      );
    `)
    await db.exec(`DELETE FROM project;`)

    // Setup mock for MultiShapeStream with two shapes
    let feedMessages: (
      lsn: number,
      messages: MultiShapeMessage[]
    ) => Promise<void> = async (_) => {}
    MockMultiShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(
        (cb: (messages: MultiShapeMessage[]) => Promise<void>) => {
          feedMessages = (lsn, messages) =>
            cb([
              ...messages,
              {
                shape: `todo_shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: lsn.toString(),
                },
              },
              {
                shape: `project_shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: lsn.toString(),
                },
              },
            ])
        }
      ),
      unsubscribeAll: vi.fn(),
      isUpToDate: true,
      shapes: {
        todo_shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
        project_shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
      },
    }))

    // Set up sync for both tables
    const onInitialSync = vi.fn()
    const syncResult = await db.electric.syncShapesToTables({
      key: `multi_sync_test`,
      shapes: {
        todo_shape: {
          shape: {
            url: `http://localhost:3000/v1/shape`,
            params: { table: `todo` },
          },
          table: `todo`,
          primaryKey: [`id`],
        },
        project_shape: {
          shape: {
            url: `http://localhost:3000/v1/shape`,
            params: { table: `project` },
          },
          table: `project`,
          primaryKey: [`id`],
        },
      },
      onInitialSync,
    })

    // Send data for both shapes in a single batch
    await feedMessages(0, [
      // Todo table inserts
      {
        headers: { operation: `insert`, lsn: `0` },
        key: `id1`,
        value: {
          id: 1,
          task: `task1`,
          done: false,
        },
        shape: `todo_shape`,
      },
      {
        headers: { operation: `insert`, lsn: `0` },
        key: `id2`,
        value: {
          id: 2,
          task: `task2`,
          done: true,
        },
        shape: `todo_shape`,
      },
      // Project table inserts
      {
        headers: { operation: `insert`, lsn: `0` },
        key: `id1`,
        value: {
          id: 1,
          name: `Project 1`,
          active: true,
        },
        shape: `project_shape`,
      },
      {
        headers: { operation: `insert`, lsn: `0` },
        key: `id2`,
        value: {
          id: 2,
          name: `Project 2`,
          active: false,
        },
        shape: `project_shape`,
      },
    ])

    // Verify data was inserted into both tables
    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT * FROM todo ORDER BY id;`)
          .all<{ id: number; task: string; done: number }>()
      ).toEqual([
        { id: 1, task: `task1`, done: 0 },
        { id: 2, task: `task2`, done: 1 },
      ])
    })

    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT * FROM project ORDER BY id;`)
          .all<{ id: number; name: string; active: number }>()
      ).toEqual([
        { id: 1, name: `Project 1`, active: 1 },
        { id: 2, name: `Project 2`, active: 0 },
      ])
    })

    // Verify onInitialSync was called
    expect(onInitialSync).toHaveBeenCalledTimes(1)

    // Test updates across both tables
    await feedMessages(1, [
      // Update todo
      {
        headers: { operation: `update`, lsn: `1` },
        key: `id1`,
        value: {
          id: 1,
          task: `Updated task 1`,
          done: true,
        },
        shape: `todo_shape`,
      },
      // Update project
      {
        headers: { operation: `update`, lsn: `1` },
        key: `id2`,
        value: {
          id: 2,
          name: `Updated Project 2`,
          active: true,
        },
        shape: `project_shape`,
      },
    ])

    // Verify updates were applied to both tables
    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT * FROM todo WHERE id = 1;`)
          .all<{ id: number; task: string; done: number }>()
      ).toEqual([{ id: 1, task: `Updated task 1`, done: 1 }])
    })

    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT * FROM project WHERE id = 2;`)
          .all<{ id: number; name: string; active: number }>()
      ).toEqual([{ id: 2, name: `Updated Project 2`, active: 1 }])
    })

    // Test deletes across both tables
    await feedMessages(2, [
      {
        headers: { operation: `delete`, lsn: `2` },
        key: `id2`,
        shape: `todo_shape`,
        value: { id: 2 },
      },
      {
        headers: { operation: `delete`, lsn: `2` },
        key: `id1`,
        shape: `project_shape`,
        value: { id: 1 },
      },
    ])

    // Verify deletes were applied to both tables
    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT COUNT(*) as count FROM todo;`)
          .all<{ count: number }>()
      ).toEqual([{ count: 1 }])
    })

    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT COUNT(*) as count FROM project;`)
          .all<{ count: number }>()
      ).toEqual([{ count: 1 }])
    })

    // Cleanup
    syncResult.unsubscribe()
  })

  it(`handles transactions across multiple tables with syncShapesToTables`, async () => {
    // Create a second table for testing multi-shape sync
    await db.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id SERIAL PRIMARY KEY,
        name TEXT,
        active BOOLEAN
      );
    `)
    await db.exec(`DELETE FROM project;`)

    // Setup mock for MultiShapeStream with two shapes and LSN tracking
    let feedMessages: (
      lsn: number,
      messages: MultiShapeMessage[]
    ) => Promise<void> = async (_lsn, _messages) => {}

    MockMultiShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(
        (cb: (messages: MultiShapeMessage[]) => Promise<void>) => {
          feedMessages = (lsn, messages) =>
            cb([
              ...messages.map((msg) => {
                if (`headers` in msg && `operation` in msg.headers) {
                  return {
                    ...msg,
                    headers: {
                      ...msg.headers,
                      lsn: lsn.toString(),
                    },
                  } as MultiShapeMessage
                }
                return msg
              }),
              {
                shape: `todo_shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: lsn.toString(),
                },
              } as MultiShapeMessage,
              {
                shape: `project_shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: lsn.toString(),
                },
              } as MultiShapeMessage,
            ])
        }
      ),
      unsubscribeAll: vi.fn(),
      isUpToDate: true,
      shapes: {
        todo_shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
        project_shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
      },
    }))

    // Set up sync for both tables
    const syncResult = await db.electric.syncShapesToTables({
      key: `transaction_test`,
      shapes: {
        todo_shape: {
          shape: {
            url: `http://localhost:3000/v1/shape`,
            params: { table: `todo` },
          },
          table: `todo`,
          primaryKey: [`id`],
        },
        project_shape: {
          shape: {
            url: `http://localhost:3000/v1/shape`,
            params: { table: `project` },
          },
          table: `project`,
          primaryKey: [`id`],
        },
      },
    })

    // Send initial data with LSN 1
    await feedMessages(1, [
      {
        headers: { operation: `insert` },
        key: `id1`,
        value: {
          id: 1,
          task: `Initial task`,
          done: false,
        },
        shape: `todo_shape`,
      },
      {
        headers: { operation: `insert` },
        key: `id1`,
        value: {
          id: 1,
          name: `Initial project`,
          active: true,
        },
        shape: `project_shape`,
      },
    ])

    // Verify initial data was inserted
    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT COUNT(*) as count FROM todo;`)
          .all<{ count: number }>()
      ).toEqual([{ count: 1 }])
    })

    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT COUNT(*) as count FROM project;`)
          .all<{ count: number }>()
      ).toEqual([{ count: 1 }])
    })

    // Simulate a transaction with LSN 2 that updates both tables
    await feedMessages(2, [
      {
        headers: { operation: `update` },
        key: `id1`,
        value: {
          id: 1,
          task: `Updated in transaction`,
          done: true,
        },
        shape: `todo_shape`,
      },
      {
        headers: { operation: `update` },
        key: `id1`,
        value: {
          id: 1,
          name: `Updated in transaction`,
          active: false,
        },
        shape: `project_shape`,
      },
    ])

    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT * FROM todo WHERE id = 1;`)
          .all<{ id: number; task: string; done: number }>()
      ).toEqual([{ id: 1, task: `Updated in transaction`, done: 1 }])
    })

    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT * FROM project WHERE id = 1;`)
          .all<{ id: number; name: string; active: number }>()
      ).toEqual([{ id: 1, name: `Updated in transaction`, active: 0 }])
    })

    // Cleanup
    syncResult.unsubscribe()
  })

  it(`handles must-refetch control message across multiple tables`, async () => {
    // Create a second table for testing multi-shape sync
    await db.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id SERIAL PRIMARY KEY,
        name TEXT,
        active BOOLEAN
      );
    `)
    await db.exec(`DELETE FROM project;`)

    // Setup mock for MultiShapeStream with refetch handling
    let feedMessages: (messages: MultiShapeMessage[]) => Promise<void> = async (
      _
    ) => {}
    let mockShapeId: string | void = undefined

    MockMultiShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(
        (cb: (messages: MultiShapeMessage[]) => Promise<void>) => {
          feedMessages = (messages) => {
            mockShapeId ??= Math.random() + ``
            if (messages.find((m) => m.headers.control === `must-refetch`)) {
              mockShapeId = undefined
            }

            return cb([
              ...messages,
              {
                shape: `todo_shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: `0`,
                },
              } as MultiShapeMessage,
              {
                shape: `project_shape`,
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: `0`,
                },
              } as MultiShapeMessage,
            ])
          }
        }
      ),
      unsubscribeAll: vi.fn(),
      isUpToDate: true,
      shapes: {
        todo_shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
        project_shape: {
          subscribe: vi.fn(),
          unsubscribeAll: vi.fn(),
        },
      },
    }))

    // Set up sync for both tables
    const syncResult = await db.electric.syncShapesToTables({
      key: `refetch_test`,
      shapes: {
        todo_shape: {
          shape: {
            url: `http://localhost:3000/v1/shape`,
            params: { table: `todo` },
          },
          table: `todo`,
          primaryKey: [`id`],
        },
        project_shape: {
          shape: {
            url: `http://localhost:3000/v1/shape`,
            params: { table: `project` },
          },
          table: `project`,
          primaryKey: [`id`],
        },
      },
    })

    // Insert initial data
    await feedMessages([
      {
        headers: { operation: `insert` },
        key: `id1`,
        value: {
          id: 1,
          task: `Initial task`,
          done: false,
        },
        shape: `todo_shape`,
      },
      {
        headers: { operation: `insert` },
        key: `id1`,
        value: {
          id: 1,
          name: `Initial project`,
          active: true,
        },
        shape: `project_shape`,
      },
    ])

    // Verify initial data was inserted
    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT COUNT(*) as count FROM todo;`)
          .all<{ count: number }>()
      ).toEqual([{ count: 1 }])
    })

    await db.mutex.runExclusive(async () => {
      expect(
        await db
          .prepare(`SELECT COUNT(*) as count FROM project;`)
          .all<{ count: number }>()
      ).toEqual([{ count: 1 }])
    })

    // Send must-refetch control message and new data
    await feedMessages([
      { headers: { control: `must-refetch` }, shape: `todo_shape` },
      { headers: { control: `must-refetch` }, shape: `project_shape` },
      {
        headers: { operation: `insert` },
        key: `id2`,
        value: {
          id: 2,
          task: `New task after refetch`,
          done: true,
        },
        shape: `todo_shape`,
      },
      {
        headers: { operation: `insert` },
        key: `id2`,
        value: {
          id: 2,
          name: `New project after refetch`,
          active: false,
        },
        shape: `project_shape`,
      },
    ])

    // Verify tables were cleared and new data was inserted
    await db.mutex.runExclusive(async () => {
      const todoResult = await db
        .prepare(`SELECT * FROM todo ORDER BY id;`)
        .all<{ id: number; task: string; done: number }>()
      expect(todoResult).toEqual([
        {
          id: 2,
          task: `New task after refetch`,
          done: 1,
        },
      ])
    })

    await db.mutex.runExclusive(async () => {
      const projectResult = await db
        .prepare(`SELECT * FROM project ORDER BY id;`)
        .all<{ id: number; name: string; active: number }>()
      expect(projectResult).toEqual([
        {
          id: 2,
          name: `New project after refetch`,
          active: 0,
        },
      ])
    })

    // Cleanup
    syncResult.unsubscribe()
  })
})
