import { BindParams, Row } from '../../util/types'
import type {
  Database as OriginalDatabase,
  Statement as OriginalStatement,
  Transaction,
  RunResult,
} from 'better-sqlite3'

export type { Transaction }

// The relevant subset of the Better-SQLite3 database client
// that we need to ensure the client we're electrifying provides.
export interface Database
  extends Pick<
    OriginalDatabase,
    'name' | 'inTransaction' | 'prepare' | 'transaction'
  > {
  exec(sql: string): this
}

export type StatementBindParams<T = BindParams> = T extends any[] ? T : [T]

// The relevant subset of the Better-SQLite3 prepared statement.
type BoundStatement<T extends any[]> = Omit<
  OriginalStatement<T>,
  'run' | 'get' | 'all' | 'iterate'
> & {
  run: (...params: T) => RunResult
  get: (...params: T) => Row | undefined
  all: (...params: T) => Row[]
  iterate: (...params: T) => IterableIterator<Row>
}

export type Statement<T extends BindParams = []> = T extends any[]
  ? BoundStatement<T>
  : BoundStatement<[T]>
