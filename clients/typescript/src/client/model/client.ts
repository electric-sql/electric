import { ElectricNamespace } from '../../electric/namespace'
import { DbSchema, TableSchema } from './schema'
import { liveRaw, raw, Table } from './table'
import { Row, Statement } from '../../util'
import { LiveResult, LiveResultContext } from './model'
import { Notifier } from '../../notifiers'
import { DatabaseAdapter } from '../../electric/adapter'
import { Satellite } from '../../satellite'
import { ShapeManager } from './shapes'

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
  liveRaw(sql: Statement): LiveResultContext<any>
}

/**
 * Electric client.
 * Extends the {@link ElectricNamespace} with a `db` property
 * providing raw query capabilities as well as a data access library for each DB table.
 */
export class ElectricClient<
  DB extends DbSchema<any>
> extends ElectricNamespace {
  private _satellite: Satellite
  public get satellite(): Satellite {
    return this._satellite
  }

  private constructor(
    public db: ClientTables<DB> & RawQueries,
    adapter: DatabaseAdapter,
    notifier: Notifier,
    satellite: Satellite
  ) {
    super(adapter, notifier)
    this._satellite = satellite
  }

  // Builds the DAL namespace from a `dbDescription` object
  static create<DB extends DbSchema<any>>(
    dbDescription: DB,
    adapter: DatabaseAdapter,
    notifier: Notifier,
    satellite: Satellite
  ): ElectricClient<DB> {
    const tables = dbDescription.extendedTables
    const shapeManager = new ShapeManager(satellite)

    const createTable = (tableName: string) => {
      return new Table(
        tableName,
        adapter,
        notifier,
        shapeManager,
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
      raw: raw.bind(null, adapter),
      liveRaw: liveRaw.bind(null, adapter),
    }

    return new ElectricClient(db, adapter, notifier, satellite)
  }
}
