import { ElectricNamespace } from '../../electric/namespace'
import { DbSchema } from './schema'
import { rawQuery, liveRawQuery, unsafeExec } from './table'
import {
  QualifiedTablename,
  ReplicatedRowTransformer,
  Row,
  Statement,
} from '../../util'
import { LiveResultContext } from './model'
import { Notifier } from '../../notifiers'
import { DatabaseAdapter } from '@electric-sql/drivers'
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
import { sqliteConverter } from '../conversions/sqlite'
import { postgresConverter } from '../conversions/postgres'
import { IShapeManager } from './shapes'
import { ShapeInputWithTable, sync } from './sync'

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
    public db: RawQueries,
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

  setReplicationTransform<T extends Row = Row>(
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
   * Builds an Electric client.
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
    const converter = dialect === 'SQLite' ? sqliteConverter : postgresConverter
    const replicationTransformManager = new ReplicationTransformManager(
      satellite,
      converter
    )

    const db: RawQueries = {
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
