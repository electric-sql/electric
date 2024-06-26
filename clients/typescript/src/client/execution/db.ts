import { RunResult } from '@electric-sql/drivers'
import { QueryBuilder } from 'squel'
import * as z from 'zod'
import { Row, Statement } from '../../util'
import { Fields } from '../model/schema'

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
    statement: QueryBuilder,
    successCallback?: (tx: DB, res: RunResult) => void,
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

  /**
   * Get instance with provided table schema for field
   * transformation and validation purposes
   */
  withTableSchema(fields: Fields): DB
}
