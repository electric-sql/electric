import { Statement } from '.'
import { DatabaseAdapter, RunResult } from '../electric'

/**
 * Runs the provided statements in a transaction and disables FK checks if `disableFKs` is true.
 * FK checks are enabled if `disableFKs` is false.
 * FK checks are left untouched if `disableFKs` is undefined.
 * `disableFKs` should only be set to true when using SQLite as we already disable FK checks for incoming TXs when using Postgres,
 * so the executed SQL code to disable FKs is for SQLite dialect only.
 */
export async function runInTransaction(
  adapter: DatabaseAdapter,
  disableFKs: boolean | undefined,
  ...stmts: Statement[]
): Promise<RunResult> {
  if (disableFKs === undefined) {
    // don't touch the FK pragma
    return adapter.runInTransaction(...stmts)
  }

  const desiredPragma = disableFKs ? 0 : 1

  return adapter.group(async (uncoordinatedAdapter) => {
    const [{ foreign_keys: originalPragma }] = await uncoordinatedAdapter.query(
      {
        sql: 'PRAGMA foreign_keys;',
      }
    )

    if (originalPragma !== desiredPragma) {
      // set the pragma to the desired value
      await uncoordinatedAdapter.run({
        sql: `PRAGMA foreign_keys = ${desiredPragma};`,
      })
    }

    try {
      // apply the statements in a TX
      const res = await uncoordinatedAdapter.runInTransaction(...stmts)
      return res
    } finally {
      // Need to restore the pragma also if TX throwed
      if (originalPragma !== desiredPragma) {
        // restore the pragma to its original value
        await uncoordinatedAdapter.run({
          sql: `PRAGMA foreign_keys = ${originalPragma};`,
        })
      }
    }
  })
}
