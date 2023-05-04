import { ElectricNamespace } from '../../electric/namespace'
import { DatabaseAdapter } from '../../electric/adapter'
import { Notifier } from '../../notifiers'
import { DbSchema, TableSchema } from './schema'
import { liveRaw, raw, Table } from './table'
import { Row, Statement } from '../../util'
import { LiveResult } from './model'

export type ClientTables<DB extends DbSchema<any>> = {
  [Tbl in keyof DB['tables']]: DB['tables'][Tbl] extends TableSchema<
    infer T,
    infer CreateData,
    infer UpdateData,
    infer Select,
    infer Where,
    infer WhereUnique,
    infer Include,
    infer OrderBy,
    infer ScalarFieldEnum,
    infer GetPayload
  >
    ? Table<
        T,
        CreateData,
        UpdateData,
        Select,
        Where,
        WhereUnique,
        Include,
        OrderBy,
        ScalarFieldEnum,
        GetPayload
      >
    : never
}

interface RawQueries {
  /**
   * Executes a raw SQL query.
   * @param sql - A raw SQL query and its bind parameters.
   * @returns The rows that result from the query.
   */
  raw(sql: Statement): Promise<Row[]>
  /**
   * A raw SQL query that can be used with {@link useLiveQuery}.
   * Same as {@link RawQueries#raw} but wraps the result in a {@link LiveResult} object.
   * @param sql - A raw SQL query and its bind parameters.
   */
  liveRaw(sql: Statement): () => Promise<LiveResult<any>>
}

/**
 * Electric client.
 * Extends the {@link ElectricNamespace} with a `db` property
 * providing raw query capabilities as well as a data access library for each DB table.
 */
export class ElectricClient<
  DB extends DbSchema<any>
> extends ElectricNamespace {
  private constructor(
    public db: ClientTables<DB> & RawQueries,
    adapter: DatabaseAdapter,
    notifier: Notifier
  ) {
    super(adapter, notifier)
  }

  // Builds the DAL namespace from a `dbDescription` object
  static create<DB extends DbSchema<any>>(
    dbDescription: DB,
    electric: ElectricNamespace
  ): ElectricClient<DB> {
    const tables = dbDescription.extendedTables
    const createTable = (tableName: string) => {
      return new Table(
        tableName,
        electric.adapter,
        electric.notifier,
        dbDescription
      )
    }

    // Create all tables
    const dal = Object.fromEntries(
      Object.keys(tables).map((tableName) => {
        return [tableName, createTable(tableName)]
      })
    ) as ClientTables<DB>

    // Now inform each table about all tables
    Object.keys(dal).forEach((tableName) => {
      dal[tableName].setTables(new Map(Object.entries(dal)))
    })

    const db: ClientTables<DB> & RawQueries = {
      ...dal,
      raw: raw.bind(null, electric.adapter),
      liveRaw: liveRaw.bind(null, electric.adapter),
    }

    return new ElectricClient(db, electric.adapter, electric.notifier)
  }
}
