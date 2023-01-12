import { AuthState } from '../auth/index'
import { ElectricConfig } from '../config/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { DbName } from '../util/types'

import { Satellite, Registry, ConsoleClient } from './index'
import {
  SatelliteClientOpts,
  SatelliteOverrides,
  SatelliteConfig,
  satelliteClientDefaults,
  satelliteDefaults,
  validateConfig,
} from './config'
import { SatelliteProcess } from './process'
import { SocketFactory } from '../sockets'
import { SatelliteClient } from './client'

export abstract class BaseRegistry implements Registry {
  satellites: {
    [key: DbName]: Satellite
  }

  startingPromises: {
    [key: DbName]: Promise<Satellite>
  }
  stoppingPromises: {
    [key: DbName]: Promise<void>
  }

  constructor() {
    this.satellites = {}
    this.startingPromises = {}
    this.stoppingPromises = {}
  }

  startProcess(
    _dbName: DbName,
    _adapter: DatabaseAdapter,
    _migrator: Migrator,
    _notifier: Notifier,
    _socketFactory: SocketFactory,
    _console: ConsoleClient,
    _config: ElectricConfig,
    _authState?: AuthState,
    _opts?: SatelliteOverrides
  ): Promise<Satellite> {
    throw `Subclasses must implement startProcess`
  }

  async ensureStarted(
    dbName: DbName,
    adapter: DatabaseAdapter,
    migrator: Migrator,
    notifier: Notifier,
    socketFactory: SocketFactory,
    console: ConsoleClient,
    config: ElectricConfig,
    authState?: AuthState,
    opts?: SatelliteOverrides
  ): Promise<Satellite> {
    // If we're in the process of stopping the satellite process for this
    // dbName, then we wait for the process to be stopped and then we
    // call this function again to retry starting it.
    const stoppingPromises = this.stoppingPromises
    const stopping = stoppingPromises[dbName]
    if (stopping !== undefined) {
      return stopping.then(() =>
        this.ensureStarted(
          dbName,
          adapter,
          migrator,
          notifier,
          socketFactory,
          console,
          config,
          authState,
          opts
        )
      )
    }

    // If we're in the process of starting the satellite process for this
    // dbName, then we short circuit and return that process. Note that
    // this assumes that the previous call to start the process for this
    // dbName would have passed in functionally equivalent `dbAdapter`,
    // `fs` and `notifier` arguments. Which is *probably* a safe assumption
    // in the case where this might happen, which is multiple components
    // in the same app opening a connection to the same db at the same time.
    const startingPromises = this.startingPromises
    const starting = startingPromises[dbName]
    if (starting !== undefined) {
      return starting
    }

    // If we already have a satellite process running for this db, then
    // return it.
    const satellites = this.satellites
    const satellite = satellites[dbName]
    if (satellite !== undefined) {
      return satellite
    }

    // Otherwise we need to fire it up!
    const startingPromise = this.startProcess(
      dbName,
      adapter,
      migrator,
      notifier,
      socketFactory,
      console,
      config,
      authState
    ).then((satellite) => {
      delete startingPromises[dbName]

      satellites[dbName] = satellite

      return satellite
    })

    startingPromises[dbName] = startingPromise
    return startingPromise
  }

  async ensureAlreadyStarted(dbName: DbName): Promise<Satellite> {
    const starting = this.startingPromises[dbName]
    if (starting !== undefined) {
      return starting
    }

    const satellite = this.satellites[dbName]
    if (satellite !== undefined) {
      return satellite
    }

    throw new Error(`Satellite not running for db: ${dbName}`)
  }

  async stop(dbName: DbName, shouldIncludeStarting = true): Promise<void> {
    // If in the process of starting, wait for it to start and then stop it.
    if (shouldIncludeStarting) {
      const stop = this.stop.bind(this)
      const startingPromises = this.startingPromises
      const starting = startingPromises[dbName]
      if (starting !== undefined) {
        return starting.then((_satellite) => stop(dbName))
      }
    }

    // If already stopping then return that promise.
    const stoppingPromises = this.stoppingPromises
    const stopping = stoppingPromises[dbName]
    if (stopping !== undefined) {
      return stopping
    }

    // Otherwise, if running then stop.
    const satellites = this.satellites
    const satellite = satellites[dbName]
    if (satellite !== undefined) {
      const stoppingPromise = satellite.stop().then(() => {
        delete satellites[dbName]
        delete stoppingPromises[dbName]
      })

      stoppingPromises[dbName] = stoppingPromise
      return stoppingPromise
    }
  }

  async stopAll(shouldIncludeStarting = true): Promise<void> {
    const stop = this.stop.bind(this)

    const running = Object.keys(this.satellites).map((dbName) => stop(dbName))
    const stopping = Object.values(this.stoppingPromises)

    let promisesToStop = running.concat(stopping)
    if (shouldIncludeStarting) {
      const starting = Object.entries(this.startingPromises).map(
        ([dbName, started]) => started.then(() => stop(dbName))
      )

      promisesToStop = promisesToStop.concat(starting)
    }

    await Promise.all(promisesToStop)
  }
}

export class GlobalRegistry extends BaseRegistry {
  async startProcess(
    dbName: DbName,
    adapter: DatabaseAdapter,
    migrator: Migrator,
    notifier: Notifier,
    socketFactory: SocketFactory,
    console: ConsoleClient,
    config: Required<ElectricConfig>,
    authState?: AuthState
  ): Promise<Satellite> {
    const foundErrors = validateConfig(config)
    if (foundErrors.length > 0) {
      throw Error(`invalid config: ${foundErrors}`)
    }

    const satelliteConfig: SatelliteConfig = {
      app: config.app,
      env: config.env,
    }

    const satelliteClientOpts: SatelliteClientOpts = {
      ...satelliteClientDefaults,
      host: config.replication.host,
      port: config.replication.port,
      ssl: config.replication.ssl,
    }

    const client = new SatelliteClient(
      dbName,
      socketFactory,
      notifier,
      satelliteClientOpts
    )
    const satellite = new SatelliteProcess(
      dbName,
      adapter,
      migrator,
      notifier,
      client,
      console,
      satelliteConfig,
      satelliteDefaults
    )
    satellite.start(authState)

    return satellite
  }
}

export const globalRegistry = new GlobalRegistry()
