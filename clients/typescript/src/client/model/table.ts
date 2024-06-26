import { DatabaseAdapter } from '@electric-sql/drivers'
import { makeFilter } from './builder'
import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import { LiveResult, LiveResultContext } from './model'
import { Notifier } from '../../notifiers'
import {
  isPotentiallyDangerous,
  parseTableNames,
  Row,
  Statement,
  createQueryResultSubscribeFunction,
  interpolateSqlArgs,
} from '../../util'

export function unsafeExec(
  adapter: DatabaseAdapter,
  sql: Statement
): Promise<Row[]> {
  return adapter.query(sql)
}

export function rawQuery(
  adapter: DatabaseAdapter,
  sql: Statement
): Promise<Row[]> {
  // only allow safe queries from the client
  if (isPotentiallyDangerous(sql.sql)) {
    throw new InvalidArgumentError(
      'Cannot use queries that might alter the store - please use read-only queries'
    )
  }

  return unsafeExec(adapter, sql)
}

export function liveRawQuery(
  adapter: DatabaseAdapter,
  notifier: Notifier,
  sql: Statement
): LiveResultContext<Row[]> {
  const result = <LiveResultContext<Row[]>>(async () => {
    // parse the table names from the query
    // because this is a raw query so
    // we cannot trust that it queries this table
    const tablenames = parseTableNames(sql.sql, adapter.defaultNamespace)
    const res = await rawQuery(adapter, sql)
    return new LiveResult(res, tablenames)
  })

  result.subscribe = createQueryResultSubscribeFunction(
    notifier,
    result,
    parseTableNames(sql.sql, adapter.defaultNamespace)
  )
  result.sourceQuery = sql
  return result
}

/** Compile Prisma-like where-clause object into a SQL where clause that the server can understand. */
export function makeSqlWhereClause(
  where: string | Record<string, any>
): string {
  if (typeof where === 'string') return where

  const statements = Object.entries(where)
    .flatMap(([key, value]) => makeFilter(value, key, 'this.'))
    .map(interpolateSqlArgsForPostgres)

  if (statements.length < 2) return statements[0] ?? ''
  else return statements.map((x) => '(' + x + ')').join(' AND ')
}

/** Interpolate SQL arguments into a string that PostgreSQL can understand. */
function interpolateSqlArgsForPostgres({
  sql,
  args,
}: {
  sql: string
  args?: unknown[]
}) {
  return interpolateSqlArgs({ sql, args: args?.map(quoteValueForPostgres) })
}

/** Quote a JS value to be inserted in a PostgreSQL where query for the server. */
function quoteValueForPostgres(value: unknown): string {
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`
  if (typeof value === 'number') return value.toString()
  if (value instanceof Date && !isNaN(value.valueOf()))
    return `'${value.toISOString()}'`
  if (typeof value === 'boolean') return value.toString()
  if (Array.isArray(value))
    return `(${value.map(quoteValueForPostgres).join(', ')})`

  throw new Error(
    `Sorry! We currently cannot handle where clauses using value ${value}. You can try serializing it to a string yourself. \nPlease leave a feature request at https://github.com/electric-sql/electric/issues.`
  )
}
