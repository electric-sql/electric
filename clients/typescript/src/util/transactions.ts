import { Statement } from '.'
import { ForeignKeyChecks } from '../config'
import { DatabaseAdapter, RunResult } from '@electric-sql/drivers'

/**
 * Runs the provided statements in a transaction and sets the `foreign_keys` pragma based on the `fkChecks` flag.
 * FK checks are enabled if `fkChecks` is `ForeignKeyChecks.enabled`.
 * FK checks are disabled if `fkChecks` is `ForeignKeyChecks.disabled`.
 * FK checks are left untouched if `fkChecks` is `ForeignKeyChecks.inherit`.
 * `fkChecks` should only be set to `ForeignKeyChecks.disabled` when using SQLite as we already disable FK checks for incoming TXs when using Postgres,
 * so the executed SQL code to disable FKs is for SQLite dialect only.
 */
export async function runInTransaction(
  adapter: DatabaseAdapter,
  fkChecks: ForeignKeyChecks,
  ...stmts: Statement[]
): Promise<RunResult> {
  if (fkChecks === ForeignKeyChecks.inherit) {
    // don't touch the FK pragma
    return adapter.runInTransaction(...stmts)
  }

  const desiredPragma = fkChecks === ForeignKeyChecks.disabled ? 0 : 1

  return adapter.runExclusively(async (uncoordinatedAdapter) => {
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
