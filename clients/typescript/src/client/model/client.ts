import { ElectricNamespace } from '../../electric/namespace'
import { DbSchema, TableSchema } from './schema'
import { rawQuery, liveRawQuery, unsafeExec, Table } from './table'
import { Row, Statement } from '../../util'
import { LiveResult, LiveResultContext } from './model'
import { Notifier } from '../../notifiers'
import { DatabaseAdapter } from '../../electric/adapter'
import { GlobalRegistry, Registry, Satellite } from '../../satellite'
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
   * Executes a raw SQL query without protecting against modifications
   * to the store that are incompatible with the replication mechanism
   *
   * [WARNING]: might break data replication, use with care!
   * @param sql - A raw SQL query and its bind parameters.
   * @returns The rows that result from the query.
   */
  unsafeExec(sql: Statement): Promise<Row[]>

  /**
   * Executes a read-only raw SQL query.
   * @param sql - A raw SQL query and its bind parameters.
   * @returns The rows that result from the query.
   */
  rawQuery(sql: Statement): Promise<Row[]>

  /**
   * A read-only raw SQL query that can be used with {@link useLiveQuery}.
   * Same as {@link RawQueries#raw} but wraps the result in a {@link LiveResult} object.
   * @param sql - A raw SQL query and its bind parameters.
   */
  liveRawQuery(sql: Statement): LiveResultContext<any>

  /**
   * @deprecated
   * For safe, read-only SQL queries, use the `rawQuery` API
   * For unsafe, store-modifying queries, use the `unsafeExec` API
   *
   * Executes a raw SQL query.
   * @param sql - A raw SQL query and its bind parameters.
   * @returns The rows that result from the query.
   */
  raw(sql: Statement): Promise<Row[]>

  /**
   * @deprecated
   * Use `liveRawQuery` instead for reactive read-only SQL queries.
   *
   * A read-only raw SQL query that can be used with {@link useLiveQuery}.
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
  private constructor(
    public db: ClientTables<DB> & RawQueries,
    dbName: string,
    adapter: DatabaseAdapter,
    notifier: Notifier,
    public readonly satellite: Satellite,
    registry: Registry | GlobalRegistry
  ) {
    super(dbName, adapter, notifier, registry)
    this.satellite = satellite
  }

  /**
   * Connects to the Electric sync service.
   * This method is idempotent, it is safe to call it multiple times.
   * @param token - The JWT token to use to connect to the Electric sync service.
   */
  async connect(token: string): Promise<void> {
    this.satellite.setToken(token)
    await this.satellite.connectWithBackoff()
  }

  /**
   * Renews the auth token before it expires.
   * Renewing is only possible while the existing auth token is still valid.
   * The token's sub claim must be the same as the one used to first authenticate.
   * @param token - The renewed JWT.
   * @throws If renewal fails.
   */
  async renew(token: string): Promise<void> {
    await this.satellite.authenticate(token)
  }

  // Builds the DAL namespace from a `dbDescription` object
  static create<DB extends DbSchema<any>>(
    dbName: string,
    dbDescription: DB,
    adapter: DatabaseAdapter,
    notifier: Notifier,
    satellite: Satellite,
    registry: Registry | GlobalRegistry
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
      unsafeExec: unsafeExec.bind(null, adapter),
      rawQuery: rawQuery.bind(null, adapter),
      liveRawQuery: liveRawQuery.bind(null, adapter, notifier),
      raw: unsafeExec.bind(null, adapter),
      liveRaw: liveRawQuery.bind(null, adapter, notifier),
    }

    return new ElectricClient(
      db,
      dbName,
      adapter,
      notifier,
      satellite,
      registry
    )
  }
}
