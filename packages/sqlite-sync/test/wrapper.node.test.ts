import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { SqliteWrapper } from '../src/'
import { betterSqliteWrapper, sqliteWasmWrapper } from '../src/'
import Database from 'better-sqlite3'

// Define test implementations
type WrapperImplementation = {
  name: string
  setup: () => Promise<{ wrapper: SqliteWrapper; cleanup: () => void }>
}

const implementations: WrapperImplementation[] = [
  {
    name: `better-sqlite3`,
    setup: async () => {
      const db = new Database(`:memory:`)
      const wrapper = betterSqliteWrapper(db)
      return {
        wrapper,
        cleanup: () => db.close(),
      }
    },
  },
  {
    name: `sqlite-wasm`,
    setup: async () => {
      const sqlite3 = await sqlite3InitModule({
        print: (msg: string) => {
          if (msg.includes(`error`) || msg.includes(`Error`)) {
            console.log(msg)
          }
        },
        printErr: console.error,
      })

      const db = new sqlite3.oo1.DB(`:memory:`, `cwt`)
      const wrapper = sqliteWasmWrapper(db)

      return {
        wrapper,
        cleanup: () => wrapper.close(),
      }
    },
  },
]

// Use describe.each to run the same tests for each implementation
describe.each(implementations)(
  `SqliteWrapper implementation: $name`,
  ({ setup }) => {
    let wrapper: SqliteWrapper
    let cleanup: () => void

    beforeEach(async () => {
      // Set up a fresh database instance for each test
      const context = await setup()
      wrapper = context.wrapper
      cleanup = context.cleanup

      // Create a test table for our tests
      await wrapper.exec(`
        CREATE TABLE IF NOT EXISTS test_table (
          id INTEGER PRIMARY KEY,
          name TEXT,
          value INTEGER
        )
      `)
    })

    afterEach(async () => {
      // Clean up resources
      try {
        await wrapper.exec(`DROP TABLE IF EXISTS test_table`)
        cleanup()
      } catch (error) {
        console.error(`Error during cleanup:`, error)
      }
    })

    test(`exec - should execute SQL statements`, async () => {
      // Insert data
      await wrapper.exec(
        `INSERT INTO test_table (id, name, value) VALUES (1, 'test1', 100)`
      )

      // Verify with a prepared statement
      const stmt = wrapper.prepare(`SELECT * FROM test_table WHERE id = ?`)
      const result = await stmt.get(1)

      expect(result).toBeDefined()
      expect(result?.id).toBe(1)
      expect(result?.name).toBe(`test1`)
      expect(result?.value).toBe(100)
    })

    test(`prepare.run - should run a prepared statement with parameters`, async () => {
      const stmt = wrapper.prepare(
        `INSERT INTO test_table (id, name, value) VALUES (?, ?, ?)`
      )
      await stmt.run(2, `test2`, 200)

      // Verify
      const selectStmt = wrapper.prepare(
        `SELECT * FROM test_table WHERE id = ?`
      )
      const result = await selectStmt.get(2)

      expect(result).toBeDefined()
      expect(result?.id).toBe(2)
      expect(result?.name).toBe(`test2`)
      expect(result?.value).toBe(200)
    })

    test(`prepare.get - should retrieve a single row`, async () => {
      // Insert test data
      const insertStmt = wrapper.prepare(
        `INSERT INTO test_table (id, name, value) VALUES (?, ?, ?)`
      )
      await insertStmt.run(3, `test3`, 300)
      await insertStmt.run(4, `test4`, 400)

      // Test get
      const stmt = wrapper.prepare(`SELECT * FROM test_table WHERE id = ?`)
      const result = await stmt.get(3)

      expect(result).toBeDefined()
      expect(result?.id).toBe(3)
      expect(result?.name).toBe(`test3`)
      expect(result?.value).toBe(300)

      // Test get with non-existent ID
      const nonExistent = await stmt.get(99)
      expect(nonExistent).toBeUndefined()
    })

    test(`prepare.all - should retrieve all matching rows`, async () => {
      // Insert test data
      const insertStmt = wrapper.prepare(
        `INSERT INTO test_table (id, name, value) VALUES (?, ?, ?)`
      )
      await insertStmt.run(5, `test5`, 500)
      await insertStmt.run(6, `test6`, 600)
      await insertStmt.run(7, `test7`, 700)

      // Test all
      const stmt = wrapper.prepare(
        `SELECT * FROM test_table WHERE id >= ? ORDER BY id`
      )
      const results = await stmt.all(5)

      expect(results).toHaveLength(3)
      expect(results[0].id).toBe(5)
      expect(results[1].id).toBe(6)
      expect(results[2].id).toBe(7)

      // Test with no matching results
      const noResults = await stmt.all(100)
      expect(noResults).toHaveLength(0)
    })

    test(`transaction - should support transactions`, async () => {
      // Execute a transaction
      await wrapper.transaction(async (tx) => {
        // Insert multiple records in a transaction
        const stmt = tx.prepare(
          `INSERT INTO test_table (id, name, value) VALUES (?, ?, ?)`
        )
        await stmt.run(10, `tx1`, 1000)
        await stmt.run(11, `tx2`, 1100)
        return `transaction completed`
      })

      // Verify transaction was committed
      const stmt = wrapper.prepare(
        `SELECT COUNT(*) as count FROM test_table WHERE id >= 10`
      )
      const result = await stmt.get()
      expect(result?.count).toBe(2)
    })

    test(`transaction - should rollback on error`, async () => {
      // Insert initial test data
      await wrapper.exec(
        `INSERT INTO test_table (id, name, value) VALUES (20, 'before_tx', 2000)`
      )

      // Execute a transaction that will fail
      try {
        await wrapper.transaction(async (tx) => {
          // This statement will succeed
          await tx.exec(
            `INSERT INTO test_table (id, name, value) VALUES (21, 'tx_will_fail', 2100)`
          )

          // This statement will fail (unique constraint violation)
          await tx.exec(
            `INSERT INTO test_table (id, name, value) VALUES (20, 'duplicate_key', 2200)`
          )
          return `should not reach here`
        })

        // Should not reach this point
        expect(true).toBe(false) // Force test failure if transaction didn't throw
      } catch (error) {
        // Expected error
        expect(error).toBeDefined()
      }

      // Verify only the initial row exists (transaction rolled back)
      const stmt = wrapper.prepare(
        `SELECT COUNT(*) as count FROM test_table WHERE id >= 20`
      )
      const result = await stmt.get()

      // This will be 1 if transaction rolled back properly, 2 if not
      expect(result?.count).toBe(1)
    })
  }
)
