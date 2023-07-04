import { AuthConfig, AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { sleepAsync } from '../util/timer'
import {
  AckCallback,
  AckType,
  AuthResponse,
  DbName,
  LSN,
  SatelliteError,
  DataTransaction,
  Transaction,
  Relation,
  SatelliteErrorCode,
  RelationsCache,
} from '../util/types'
import { ElectricConfig } from '../config/index'
import { randomValue } from '../util/random'

import { Client, ConnectionWrapper, Satellite } from './index'
import { SatelliteOpts, SatelliteOverrides, satelliteDefaults } from './config'
import { BaseRegistry } from './registry'
import { SocketFactory } from '../sockets'
import { EventEmitter } from 'events'
import { DEFAULT_LOG_POS, subscriptionErrorToSatelliteError } from '../util'
import { bytesToNumber, uuid } from '../util/common'
import { generateTag } from './oplog'
import {
  ClientShapeDefinition,
  InitialDataChange,
  SUBSCRIPTION_DELIVERED,
  SUBSCRIPTION_ERROR,
  ShapeRequest,
  SubscribeResponse,
  SubscriptionData,
  SubscriptionDeliveredCallback,
  SubscriptionErrorCallback,
} from './shapes/types'
import {
  SatSubsError,
  SatSubsError_Code,
  SatSubsError_ShapeReqError,
  SatSubsError_ShapeReqError_Code,
} from '../_generated/protocol/satellite'

export const MOCK_BEHIND_WINDOW_LSN = 42
export const MOCK_INVALID_POSITION_LSN = 27

export class MockSatelliteProcess implements Satellite {
  dbName: DbName
  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier
  socketFactory: SocketFactory
  opts: SatelliteOpts

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
  }
  subscribe(_shapeDefinitions: ClientShapeDefinition[]): Promise<void> {
    return Promise.resolve()
  }

  unsubscribe(_shapeUuid: string): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async start(_authConfig: AuthConfig): Promise<ConnectionWrapper> {
    await sleepAsync(50)
    return {
      connectionPromise: new Promise((resolve) => resolve()),
    }
  }

  async stop(): Promise<void> {
    await sleepAsync(50)
  }
}

export class MockRegistry extends BaseRegistry {
  async startProcess(
    dbName: DbName,
    adapter: DatabaseAdapter,
    migrator: Migrator,
    notifier: Notifier,
    socketFactory: SocketFactory,
    config: ElectricConfig,
    overrides?: SatelliteOverrides
  ): Promise<Satellite> {
    const opts = { ...satelliteDefaults, ...overrides }

    const satellite = new MockSatelliteProcess(
      dbName,
      adapter,
      migrator,
      notifier,
      socketFactory,
      opts
    )
    await satellite.start(config.auth)

    return satellite
  }
}

export class MockSatelliteClient extends EventEmitter implements Client {
  replicating = false
  closed = true
  inboundAck: Uint8Array = DEFAULT_LOG_POS

  outboundSent: Uint8Array = DEFAULT_LOG_POS
  outboundAck: Uint8Array = DEFAULT_LOG_POS

  // to clear any pending timeouts
  timeouts: NodeJS.Timeout[] = []

  relations: RelationsCache = {}

  setRelations(relations: RelationsCache): void {
    this.relations = relations
  }

  subscribe(shapes: ShapeRequest[]): Promise<SubscribeResponse> {
    const subscriptionId = randomValue()

    const tablename = shapes[0]?.definition.selects[0]?.tablename
    if (tablename == 'parent' || tablename == 'child') {
      const shapeReqToUuid = {
        [shapes[0].requestId]: uuid(),
      }

      const parentRecord = {
        id: 1,
        value: 'incoming',
        other: 1,
      }

      const childRecord = {
        id: 1,
        parent: 1,
      }

      const dataChange: InitialDataChange = {
        relation: this.relations[tablename],
        record: tablename == 'parent' ? parentRecord : childRecord,
        tags: [generateTag('remote', new Date())],
      }

      const subsciptionData: SubscriptionData = {
        subscriptionId,
        data: [dataChange],
        shapeReqToUuid,
      }

      setTimeout(() => {
        this.emit(SUBSCRIPTION_DELIVERED, subsciptionData)
      }, 1)
    }

    if (tablename == 'another') {
      setTimeout(() => {
        const satSubsError: SatSubsError = SatSubsError.fromPartial({
          code: SatSubsError_Code.SHAPE_REQUEST_ERROR,
          message: 'there were shape errors',
          subscriptionId,
          shapeRequestError: [
            SatSubsError_ShapeReqError.fromPartial({
              code: SatSubsError_ShapeReqError_Code.TABLE_NOT_FOUND,
              message: 'table another does not exist',
            }),
          ],
        })

        const satError = subscriptionErrorToSatelliteError(satSubsError)
        this.emit(SUBSCRIPTION_ERROR, satError)
      }, 1)
    }

    return Promise.resolve({
      subscriptionId,
    })
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

  isClosed(): boolean {
    return this.closed
  }
  resetOutboundLogPositions(sent: Uint8Array, ack: Uint8Array): void {
    this.outboundSent = sent
    this.outboundAck = ack
  }
  getOutboundLogPositions(): { enqueued: Uint8Array; ack: Uint8Array } {
    return { enqueued: this.outboundSent, ack: this.outboundAck }
  }
  connect(): Promise<void | SatelliteError> {
    this.closed = false
    return Promise.resolve()
  }
  close(): Promise<void | SatelliteError> {
    this.closed = true
    for (const t of this.timeouts) {
      clearTimeout(t)
    }
    return Promise.resolve()
  }
  authenticate(_authState: AuthState): Promise<SatelliteError | AuthResponse> {
    return Promise.resolve({})
  }
  startReplication(lsn: LSN): Promise<void> {
    this.replicating = true
    this.inboundAck = lsn

    const t = setTimeout(() => this.emit('outbound_started'), 100)
    this.timeouts.push(t)

    if (lsn && bytesToNumber(lsn) == MOCK_BEHIND_WINDOW_LSN) {
      return Promise.reject(
        new SatelliteError(
          SatelliteErrorCode.BEHIND_WINDOW,
          'MOCK BEHIND_WINDOW_LSN ERROR'
        )
      )
    }

    if (lsn && bytesToNumber(lsn) == MOCK_INVALID_POSITION_LSN) {
      return Promise.reject(
        new SatelliteError(
          SatelliteErrorCode.INVALID_POSITION,
          'MOCK INVALID_POSITION ERROR'
        )
      )
    }

    return Promise.resolve()
  }
  stopReplication(): Promise<void | SatelliteError> {
    this.replicating = false
    return Promise.resolve()
  }

  subscribeToRelations(_callback: (relation: Relation) => void): void {}

  subscribeToTransactions(
    _callback: (transaction: Transaction) => Promise<void>
  ): void {}

  enqueueTransaction(transaction: DataTransaction): void | SatelliteError {
    this.outboundSent = transaction.lsn

    this.emit('ack_lsn', transaction.lsn, AckType.LOCAL_SEND)

    // simulate ping message effect
    const t = setTimeout(() => {
      this.outboundAck = transaction.lsn
      this.emit('ack_lsn', transaction.lsn, AckType.REMOTE_COMMIT)
    }, 100)
    this.timeouts.push(t)
  }

  subscribeToAck(callback: AckCallback): void {
    this.on('ack_lsn', callback)
  }

  unsubscribeToAck(callback: AckCallback): void {
    this.removeListener('ack_lsn', callback)
  }

  setOutboundLogPositions(sent: LSN, ack: LSN): void {
    this.outboundSent = sent
    this.outboundAck = ack
  }

  subscribeToOutboundEvent(_event: 'started', callback: () => void): void {
    this.on('outbound_started', callback)
  }
  unsubscribeToOutboundEvent(_event: 'started', callback: () => void): void {
    this.removeListener('outbound_started', callback)
  }
}
