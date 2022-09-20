import { AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { sleepAsync } from '../util/timer'
import { AuthResponse, DbName, SatelliteError } from '../util/types'

import { Satellite } from './index'
import { SatelliteOpts, SatelliteOverrides, satelliteDefaults } from './config'
import { BaseRegistry } from './registry'
import EventEmitter from 'events'
import { SatelliteClient, Transaction } from './client'

export class MockSatelliteProcess implements Satellite {
  dbName: DbName
  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier
  opts: SatelliteOpts

  constructor(dbName: DbName, adapter: DatabaseAdapter, migrator: Migrator, notifier: Notifier, opts: SatelliteOpts) {
    this.dbName = dbName
    this.adapter = adapter
    this.migrator = migrator
    this.notifier = notifier
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
        authState?: AuthState,
        overrides?: SatelliteOverrides
      ): Promise<Satellite> {
    const opts = {...satelliteDefaults, ...overrides}

    const satellite = new MockSatelliteProcess(dbName, adapter, migrator, notifier, opts)
    await satellite.start(authState)

    return satellite
  }
}

export class MockSatelliteClient extends EventEmitter implements SatelliteClient {
  connect(): Promise<void | SatelliteError> {
    return Promise.resolve();
  }
  close(): Promise<void | SatelliteError> {
    return Promise.resolve();
  }
  authenticate(): Promise<SatelliteError | AuthResponse> {
    return Promise.resolve({});
  }
  startReplication(_lsn: string, _resume?: boolean | undefined): Promise<void | SatelliteError> {
    return Promise.resolve();
  }
  stopReplication(): Promise<void | SatelliteError> {
    return Promise.resolve();
  }
  subscribeToTransactions(_callback: (transaction: Transaction) => Promise<void>): void {
  }
}
