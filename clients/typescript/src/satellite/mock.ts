import { AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { sleepAsync } from '../util/timer'
import {
  AuthResponse,
  DbName,
  LSN,
  SatelliteError,
  DataTransaction,
  Relation,
  SatelliteErrorCode,
  RelationsCache,
  DbRecord as DataRecord,
  StartReplicationResponse,
  StopReplicationResponse,
  OutboundStartedCallback,
  TransactionCallback,
  SocketCloseReason,
  ReplicationStatus,
  AdditionalDataCallback,
  ConnectivityState,
  ReplicatedRowTransformer,
  GoneBatchCallback,
  DataGone,
  DataChangeType,
} from '../util/types'
import { ElectricConfig } from '../config/index'

import { Client, Satellite } from './index'
import { SatelliteOpts, SatelliteOverrides, satelliteDefaults } from './config'
import { BaseRegistry } from './registry'
import { SocketFactory } from '../sockets'
import {
  DEFAULT_LOG_POS,
  subsDataErrorToSatelliteError,
  AsyncEventEmitter,
  genUUID,
  QualifiedTablename,
} from '../util'
import { base64, bytesToNumber } from '../util/encoders'
import { generateTag } from './oplog'
import {
  Shape,
  InitialDataChange,
  SUBSCRIPTION_DELIVERED,
  SUBSCRIPTION_ERROR,
  ShapeRequest,
  SubscribeResponse,
  SubscriptionData,
  SubscriptionDeliveredCallback,
  SubscriptionErrorCallback,
  UnsubscribeResponse,
} from './shapes/types'
import {
  SatSubsDataError,
  SatSubsDataError_Code,
  SatSubsDataError_ShapeReqError,
  SatSubsDataError_ShapeReqError_Code,
} from '../_generated/protocol/satellite'
import { ShapeSubscription } from './process'
import { DbSchema } from '../client/model/schema'
import { getAllTablesForShape } from './shapes'
import { SyncStatus } from '../client/model/shapes'

export const MOCK_BEHIND_WINDOW_LSN = 42
export const MOCK_INTERNAL_ERROR = 27

export class MockSatelliteProcess implements Satellite {
  dbName: DbName
  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier
  socketFactory: SocketFactory
  opts: SatelliteOpts
  token: string | undefined
  connectivityState?: ConnectivityState

  constructor(
    dbName: DbName,
    adapter: DatabaseAdapter,
    migrator: Migrator,
    notifier: Notifier,
    socketFactory: SocketFactory,
    opts: SatelliteOpts
  ) {
    this.dbName = dbName
    this.adapter = adapter
    this.migrator = migrator
    this.notifier = notifier
    this.socketFactory = socketFactory
    this.opts = opts
    this.connectivityState = { status: 'disconnected' }
  }

  syncStatus(_key: string): SyncStatus {
    return undefined
  }

  subscribe(_shapeDefinitions: Shape[]): Promise<ShapeSubscription> {
    return Promise.resolve({
      key: 'test',
      synced: Promise.resolve(),
    })
  }

  unsubscribe(_shapeUuid: any): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async start(): Promise<void> {
    await sleepAsync(50)
  }

  setToken(token: string): void {
    this.token = token
  }

  hasToken() {
    return this.token !== undefined
  }

  async connect(): Promise<void> {
    await sleepAsync(50)
  }

  async connectWithBackoff(): Promise<void> {
    await this.connect()
  }

  disconnect(): void {}
  clientDisconnect(): void {}

  authenticate(_token: string): Promise<void> {
    return Promise.resolve()
  }

  async stop(): Promise<void> {
    await sleepAsync(50)
  }

  setReplicationTransform(
    _tableName: QualifiedTablename,
    _transform: ReplicatedRowTransformer<DataRecord>
  ): void {}

  clearReplicationTransform(_tableName: QualifiedTablename): void {}
}

export class MockRegistry extends BaseRegistry {
  private shouldFailToStart = false

  setShouldFailToStart(shouldFail: boolean): void {
    this.shouldFailToStart = shouldFail
  }

  async startProcess(
    dbName: DbName,
    _dbDescription: DbSchema<any>,
    adapter: DatabaseAdapter,
    migrator: Migrator,
    notifier: Notifier,
    socketFactory: SocketFactory,
    _config: ElectricConfig,
    overrides?: SatelliteOverrides
  ): Promise<Satellite> {
    if (this.shouldFailToStart) {
      throw new Error('Failed to start satellite process')
    }

    const namespace = migrator.queryBuilder.defaultNamespace
    const opts = { ...satelliteDefaults(namespace), ...overrides }

    const satellites = this.satellites
    if (satellites[dbName] !== undefined) {
      return satellites[dbName]
    }

    const satellite = new MockSatelliteProcess(
      dbName,
      adapter,
      migrator,
      notifier,
      socketFactory,
      opts
    )
    this.satellites[dbName] = satellite
    await satellite.start()
    return satellite
  }
}

type Events = {
  [SUBSCRIPTION_DELIVERED]: (data: SubscriptionData) => void
  [SUBSCRIPTION_ERROR]: (error: SatelliteError, subscriptionId: string) => void
  outbound_started: OutboundStartedCallback
  error: (error: SatelliteError) => void
  goneBatch: GoneBatchCallback
}
export class MockSatelliteClient
  extends AsyncEventEmitter<Events>
  implements Client
{
  isDown = false
  replicating = false
  disconnected = true
  inboundAck: Uint8Array = DEFAULT_LOG_POS

  outboundSent: Uint8Array = DEFAULT_LOG_POS
  outboundTransactionsEnqueued: DataTransaction[] = []

  // to clear any pending timeouts
  timeouts: NodeJS.Timeout[] = []

  relations: RelationsCache = {}
  relationsCb?: (relation: Relation) => void
  transactionsCb?: TransactionCallback
  additionalDataCb?: AdditionalDataCallback

  outboundStartedCallback?: OutboundStartedCallback

  relationData: Record<string, DataRecord[]> = {}
  goneBatches: Record<string, DataGone[]> = {}

  deliverFirst = false
  doSkipNextEmit = false

  private startReplicationDelayMs: number | null = null

  setStartReplicationDelayMs(delayMs: number | null) {
    this.startReplicationDelayMs = delayMs
  }

  setRelations(relations: RelationsCache): void {
    this.relations = relations
    if (this.relationsCb) {
      Object.values(relations).forEach(this.relationsCb)
    }
  }

  setRelationData(tablename: string, record: DataRecord): void {
    if (!this.relationData[tablename]) {
      this.relationData[tablename] = []
    }
    const data = this.relationData[tablename]

    data.push(record)
  }

  setGoneBatch(
    subscriptionId: string,
    batch: { tablename: string; record: DataGone['oldRecord'] }[]
  ): void {
    this.goneBatches[subscriptionId] = batch.map((x) => ({
      type: DataChangeType.GONE,
      tags: [],
      relation: this.relations[x.tablename],
      oldRecord: x.record,
    }))
  }

  enableDeliverFirst() {
    this.deliverFirst = true
  }

  skipNextEmit() {
    this.doSkipNextEmit = true
  }

  subscribe(
    subscriptionId: string,
    shapes: ShapeRequest[]
  ): Promise<SubscribeResponse> {
    const data: InitialDataChange[] = []
    const shapeReqToUuid: Record<string, string> = {}

    for (const shape of shapes) {
      const tables = getAllTablesForShape(shape.definition, 'main')
      for (const { tablename } of tables) {
        if (tablename === 'failure' || tablename === 'Items') {
          return Promise.resolve({
            subscriptionId,
            error: new SatelliteError(SatelliteErrorCode.TABLE_NOT_FOUND),
          })
        } else if (tablename === 'another' || tablename === 'User') {
          return new Promise((resolve) => {
            this.sendErrorAfterTimeout(subscriptionId, 1)
            resolve({
              subscriptionId,
            })
          })
        } else {
          shapeReqToUuid[shape.requestId] = genUUID()
          const records: DataRecord[] = this.relationData[tablename] ?? []

          for (const record of records) {
            const dataChange: InitialDataChange = {
              relation: this.relations[tablename],
              record,
              tags: [generateTag('remote', new Date())],
            }
            data.push(dataChange)
          }
        }
      }
    }

    return new Promise((resolve) => {
      const emit = () => {
        this.enqueueEmit(SUBSCRIPTION_DELIVERED, {
          subscriptionId,
          lsn: base64.toBytes('MTIz'), // base64.encode("123")
          data,
          shapeReqToUuid,
        } as SubscriptionData)
      }

      const resolveProm = () => {
        resolve({
          subscriptionId,
        })
      }

      if (this.deliverFirst) {
        // When the `deliverFirst` flag is set,
        // we deliver the subscription before resolving the promise.
        emit()
        setTimeout(resolveProm, 1)
      } else {
        // Otherwise, we resolve the promise before delivering the subscription.
        if (!this.doSkipNextEmit) setTimeout(emit, 1)
        else this.doSkipNextEmit = false
        resolveProm()
      }
    })
  }

  unsubscribe(subIds: string[]): Promise<UnsubscribeResponse> {
    const gone: DataGone[] = []

    for (const id of subIds) {
      gone.push(...(this.goneBatches[id] ?? []))
      delete this.goneBatches[id]
    }

    setTimeout(
      () =>
        this.enqueueEmit(
          'goneBatch',
          base64.toBytes(base64.encode('124')),
          subIds,
          gone
        ),
      1
    )
    return Promise.resolve({})
  }

  subscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void {
    this.on(SUBSCRIPTION_DELIVERED, successCallback)
    this.on(SUBSCRIPTION_ERROR, errorCallback)
  }

  unsubscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void {
    this.removeListener(SUBSCRIPTION_DELIVERED, successCallback)
    this.removeListener(SUBSCRIPTION_ERROR, errorCallback)
  }

  subscribeToGoneBatch(callback: GoneBatchCallback): void {
    this.on('goneBatch', callback)
  }

  unsubscribeToGoneBatch(callback: GoneBatchCallback): void {
    this.off('goneBatch', callback)
  }

  subscribeToError(cb: (error: SatelliteError) => void): void {
    this.on('error', cb)
  }

  emitSocketClosedError(ev: SocketCloseReason): void {
    this.enqueueEmit('error', new SatelliteError(ev, 'socket closed'))
  }

  unsubscribeToError(cb: (error: SatelliteError) => void): void {
    this.removeListener('error', cb)
  }

  isConnected(): boolean {
    return !this.disconnected
  }

  getOutboundReplicationStatus(): ReplicationStatus {
    return this.isConnected() && this.replicating
      ? ReplicationStatus.ACTIVE
      : ReplicationStatus.STOPPED
  }

  shutdown(): void {
    this.isDown = true
  }

  getLastSentLsn(): Uint8Array {
    return this.outboundSent
  }
  connect(): Promise<void> {
    if (this.isDown) {
      throw new SatelliteError(SatelliteErrorCode.UNEXPECTED_STATE, 'FAKE DOWN')
    }

    this.disconnected = false
    return Promise.resolve()
  }
  disconnect(): Promise<void> {
    this.disconnected = true
    for (const t of this.timeouts) {
      clearTimeout(t)
    }
    return Promise.resolve()
  }
  authenticate(_authState: AuthState): Promise<AuthResponse> {
    return Promise.resolve({})
  }
  async startReplication(lsn: LSN): Promise<StartReplicationResponse> {
    if (this.startReplicationDelayMs) {
      await sleepAsync(this.startReplicationDelayMs)
    }

    this.replicating = true
    this.inboundAck = lsn

    const t = setTimeout(() => this.enqueueEmit('outbound_started'), 100)
    this.timeouts.push(t)

    if (lsn && bytesToNumber(lsn) == MOCK_BEHIND_WINDOW_LSN) {
      return {
        error: new SatelliteError(
          SatelliteErrorCode.BEHIND_WINDOW,
          'MOCK BEHIND_WINDOW_LSN ERROR'
        ),
      }
    }

    if (lsn && bytesToNumber(lsn) == MOCK_INTERNAL_ERROR) {
      return {
        error: new SatelliteError(
          SatelliteErrorCode.INTERNAL,
          'MOCK INTERNAL_ERROR'
        ),
      }
    }

    return Promise.resolve({})
  }

  stopReplication(): Promise<StopReplicationResponse> {
    this.replicating = false
    return Promise.resolve({})
  }

  subscribeToRelations(callback: (relation: Relation) => void): void {
    this.relationsCb = callback
  }

  unsubscribeToRelations(): void {
    this.relationsCb = undefined
  }

  subscribeToTransactions(callback: TransactionCallback): void {
    this.transactionsCb = callback
  }

  unsubscribeToTransactions(): void {
    this.transactionsCb = undefined
  }

  subscribeToAdditionalData(callback: AdditionalDataCallback): void {
    this.additionalDataCb = callback
  }

  unsubscribeToAdditionalData(_cb: AdditionalDataCallback): void {
    this.additionalDataCb = undefined
  }

  enqueueTransaction(transaction: DataTransaction): void {
    if (!this.replicating) {
      throw new SatelliteError(
        SatelliteErrorCode.REPLICATION_NOT_STARTED,
        'enqueuing a transaction while outbound replication has not started'
      )
    }

    this.outboundTransactionsEnqueued.push(transaction)
    this.outboundSent = transaction.lsn
  }

  subscribeToOutboundStarted(callback: OutboundStartedCallback): void {
    this.on('outbound_started', callback)
    this.outboundStartedCallback = callback
  }

  unsubscribeToOutboundStarted(): void {
    if (!this.outboundStartedCallback) return
    this.removeListener('outbound_started', this.outboundStartedCallback)
    this.outboundStartedCallback = undefined
  }

  sendErrorAfterTimeout(subscriptionId: string, timeout: number): void {
    setTimeout(() => {
      const satSubsError: SatSubsDataError = SatSubsDataError.fromPartial({
        code: SatSubsDataError_Code.SHAPE_DELIVERY_ERROR,
        message: 'there were shape errors',
        subscriptionId,
        shapeRequestError: [
          SatSubsDataError_ShapeReqError.fromPartial({
            code: SatSubsDataError_ShapeReqError_Code.SHAPE_SIZE_LIMIT_EXCEEDED,
            message:
              "Requested shape for table 'another' exceeds the maximum allowed shape size",
          }),
        ],
      })

      const satError = subsDataErrorToSatelliteError(satSubsError)
      this.enqueueEmit(SUBSCRIPTION_ERROR, satError, subscriptionId)
    }, timeout)
  }

  setReplicationTransform(
    _tableName: QualifiedTablename,
    _transform: ReplicatedRowTransformer<DataRecord>
  ): void {
    throw new Error('Method not implemented.')
  }
  clearReplicationTransform(_tableName: QualifiedTablename): void {
    throw new Error('Method not implemented.')
  }
}
