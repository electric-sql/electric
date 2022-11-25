import { AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { sleepAsync } from '../util/timer'
import { AckCallback, AckType, AuthResponse, DbName, LSN, SatelliteError, Transaction } from '../util/types'

import { Client, Satellite } from './index'
import { SatelliteOpts, SatelliteOverrides, satelliteDefaults } from './config'
import { BaseRegistry } from './registry'
import { SocketFactory } from '../sockets'
import { EventEmitter } from 'events'
import { DEFAULT_LSN } from '../util'

export class MockSatelliteProcess implements Satellite {
  dbName: DbName
  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier
  socketFactory: SocketFactory
  opts: SatelliteOpts

  constructor(dbName: DbName, adapter: DatabaseAdapter, migrator: Migrator, notifier: Notifier, socketFactory: SocketFactory, opts: SatelliteOpts) {
    this.dbName = dbName
    this.adapter = adapter
    this.migrator = migrator
    this.notifier = notifier
    this.socketFactory = socketFactory
    this.opts = opts
  }

  async start(_authState?: AuthState): Promise<void> {
    await sleepAsync(50)
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
        authState?: AuthState,
        overrides?: SatelliteOverrides
      ): Promise<Satellite> {
    const opts = { ...satelliteDefaults, ...overrides }

    const satellite = new MockSatelliteProcess(dbName, adapter, migrator, notifier, socketFactory, opts)
    await satellite.start(authState)

    return satellite
  }
}

export class MockSatelliteClient extends EventEmitter implements Client {  
  replicating = false
  closed = true
  inboundAck: Uint8Array = DEFAULT_LSN

  outboundSent: Uint8Array = DEFAULT_LSN
  outboundAck: Uint8Array = DEFAULT_LSN

  // to clear any pending timeouts
  timeouts: NodeJS.Timeout[] = []

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
    for (let t of this.timeouts) {
      clearTimeout(t)
    }
    return Promise.resolve()
  }
  authenticate(_clientId: string): Promise<SatelliteError | AuthResponse> {
    return Promise.resolve({});
  }
  startReplication(lsn: LSN, _resume?: boolean | undefined): Promise<void | SatelliteError> {
    this.replicating = true
    this.inboundAck = lsn

    const t = setTimeout(() => this.emit('outbound_started'), 100)
    this.timeouts.push(t)

    return Promise.resolve();
  }
  stopReplication(): Promise<void | SatelliteError> {
    this.replicating = false
    return Promise.resolve();
  }

  subscribeToTransactions(_callback: (transaction: Transaction) => Promise<void>): void {
  }

  enqueueTransaction(transaction: Transaction): void | SatelliteError {
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
