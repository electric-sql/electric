import { RunResult } from '../../electric/adapter'
import { QueryBuilder } from 'squel'
import * as z from 'zod'

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
}
