import { Statement } from '.'
import { DatabaseAdapter, RunResult } from '../electric'

/**
 * Runs the provided statements in a transaction and disables FK checks if `disableFKs` is true.
 * `disableFKs` should only be set to true when using SQLite as we already disable FK checks for incoming TXs when using Postgres,
 * so the executed SQL code to disable FKs is for SQLite dialect only.
 * @param adapter
 * @param disableFKs
 * @param stmts
 * @returns
 */
export async function runInTransaction(
  adapter: DatabaseAdapter,
  disableFKs: boolean,
  ...stmts: Statement[]
): Promise<RunResult> {
  return adapter.group(async (uncoordinatedAdapter) => {
    let enableFKs = false
    if (disableFKs) {
      // Check if FKs are enabled
      const [{ foreign_keys }] = await uncoordinatedAdapter.query({
        sql: 'PRAGMA foreign_keys;',
      })
      if (foreign_keys === 1) {
        // Disable FKs
        await uncoordinatedAdapter.run({ sql: 'PRAGMA foreign_keys = OFF;' })
        // Remember to enable FKs after TX
        enableFKs = foreign_keys === 1
      }
    }
    const res = await uncoordinatedAdapter.runInTransaction(...stmts)
    if (enableFKs) {
      // re-enable FKs
      await uncoordinatedAdapter.run({ sql: 'PRAGMA foreign_keys = ON;' })
    }
    return res
  })
}
