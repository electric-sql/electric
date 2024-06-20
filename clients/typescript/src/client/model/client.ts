import { ElectricNamespace } from '../../electric/namespace'
import { DbSchema, TableSchema, TableSchemas } from './schema'
import { rawQuery, liveRawQuery, unsafeExec, Table } from './table'
import {
  QualifiedTablename,
  ReplicatedRowTransformer,
  Row,
  Statement,
} from '../../util'
import { LiveResultContext } from './model'
import { Notifier } from '../../notifiers'
import { DatabaseAdapter } from '../../electric/adapter'
import {
  GlobalRegistry,
  Registry,
  Satellite,
  ShapeSubscription,
} from '../../satellite'
import {
  IReplicationTransformManager,
  ReplicationTransformManager,
  setReplicationTransform,
} from './transforms'
import { Dialect } from '../../migrators/query-builder/builder'
import { InputTransformer } from '../conversions/input'
import { sqliteConverter } from '../conversions/sqlite'
import { postgresConverter } from '../conversions/postgres'
import { IShapeManager } from './shapes'
import { ShapeInputWithTable, sync } from './sync'

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
  public sync: Omit<IShapeManager, 'subscribe'> & {
    /**
     * Subscribes to the given shape, returnig a {@link ShapeSubscription} object which
     * can be used to wait for the shape to sync initial data.
     *
     * NOTE: If you establish a shape subscription that has already synced its initial data,
     * awaiting `shape.synced` will always resolve immediately as shape subscriptions are persisted.
     * i.e.: imagine that you re-sync the same shape during subsequent application loads.
     * Awaiting `shape.synced` a second time will only ensure that the initial
     * shape load is complete. It does not ensure that the replication stream
     * has caught up to the central DB's more recent state.
     *
     * @param i - The shape to subscribe to
     * @param key - An optional unique key that identifies the subscription
     * @returns A shape subscription
     */
    subscribe: (
      i: ShapeInputWithTable,
      key?: string
    ) => Promise<ShapeSubscription>
  }

  private constructor(
    public db: ClientTables<DB> & RawQueries,
    dbName: string,
    private _dbDescription: DB,
    adapter: DatabaseAdapter,
    notifier: Notifier,
    public readonly satellite: Satellite,
    registry: Registry | GlobalRegistry,
    private _replicationTransformManager: IReplicationTransformManager
  ) {
    super(dbName, adapter, notifier, registry)
    this.satellite = satellite
    // Expose the Shape Sync API without additional properties
    this.sync = {
      syncStatus: this.satellite.syncStatus.bind(this.satellite),
      subscribe: sync.bind(null, this.satellite, this._dbDescription),
      unsubscribe: this.satellite.unsubscribe.bind(this.satellite),
    }
  }

  setReplicationTransform<
    T extends Record<string, unknown> = Record<string, unknown>
  >(
    qualifiedTableName: QualifiedTablename,
    i: ReplicatedRowTransformer<T>
  ): void {
    setReplicationTransform<T>(
      this._dbDescription,
      this._replicationTransformManager,
      qualifiedTableName,
      i
    )
  }

  /**
   * Connects to the Electric sync service.
   * This method is idempotent, it is safe to call it multiple times.
   * @param token - The JWT token to use to connect to the Electric sync service.
   *                This token is required on first connection but can be left out when reconnecting
   *                in which case the last seen token is reused.
   */
  async connect(token?: string): Promise<void> {
    if (token === undefined && !this.satellite.hasToken()) {
      throw new Error('A token is required the first time you connect.')
    }
    if (token !== undefined) {
      this.satellite.setToken(token)
    }
    await this.satellite.connectWithBackoff()
  }

  disconnect(): void {
    this.satellite.clientDisconnect()
  }

  /**
   * Builds the DAL namespace from a `dbDescription` object
   * @param minimalDbDescription - A minimal description of the database schema can be provided in order to use Electric without the DAL.
   */
  static create<DB extends DbSchema<any>>(
    dbName: string,
    dbDescription: DB,
    adapter: DatabaseAdapter,
    notifier: Notifier,
    satellite: Satellite,
    registry: Registry | GlobalRegistry,
    dialect: Dialect
  ): ElectricClient<DB> {
    const tables = dbDescription.extendedTables
    const converter = dialect === 'SQLite' ? sqliteConverter : postgresConverter
    const replicationTransformManager = new ReplicationTransformManager(
      satellite,
      converter
    )
    const inputTransformer = new InputTransformer(converter)

    // Check if we need to create the DAL
    // If the schemas are missing from the `dbDescription``
    // it means that the user did not generate the Electric client
    // and thus we don't create the DAL.
    // This is needed because we piggyback the minimal DB description (that is used without the DAL)
    // on the same DB description argument as the one that is used with the DAL.
    const ts: Array<[string, TableSchemas]> = Object.entries(
      dbDescription.tables
    )
    const withDal = ts.length > 0 && ts[0][1].modelSchema !== undefined
    let dal = {} as ClientTables<DB>

    if (withDal) {
      const createTable = (tableName: string) => {
        return new Table(
          tableName,
          adapter,
          notifier,
          satellite,
          replicationTransformManager,
          dbDescription,
          inputTransformer,
          dialect
        )
      }

      // Create all tables
      dal = Object.fromEntries(
        Object.keys(tables).map((tableName) => {
          return [tableName, createTable(tableName)]
        })
      ) as ClientTables<DB>

      // Now inform each table about all tables
      Object.keys(dal).forEach((tableName) => {
        dal[tableName].setTables(new Map(Object.entries(dal)))
      })
    }

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
      dbDescription,
      adapter,
      notifier,
      satellite,
      registry,
      replicationTransformManager
    )
  }
}
