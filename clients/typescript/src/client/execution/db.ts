import { RunResult } from '../../electric/adapter'
import { QueryBuilder } from 'squel'
import * as z from 'zod'
import { Row, Statement } from '../../util'

/**
 * Interface that must be implemented by DB implementations.
 * The `run` and `query` methods are callback-based
 * because the `transactionalDB` is implemented atop
 * Electric's DatabaseAdapter which supports transactions
 * but requires a callback-based style because
 * some underlying drivers do not support promises.
 */
export interface DB {
  run(
    statement: string,
    successCallback?: (tx: DB, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void
  run(
    statement: QueryBuilder,
    successCallback?: (tx: DB, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void
  query<Z>(
    statement: string,
    schema: z.ZodType<Z>,
    successCallback: (tx: DB, res: Z[]) => void,
    errorCallback?: (error: any) => void
  ): void
  query<Z>(
    statement: QueryBuilder,
    schema: z.ZodType<Z>,
    successCallback: (tx: DB, res: Z[]) => void,
    errorCallback?: (error: any) => void
  ): void
  raw(
    sql: Statement,
    successCallback: (tx: DB, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void
}
