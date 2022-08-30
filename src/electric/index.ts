import { AnyDatabase, AnyElectricDatabase } from '../adapters/index'
import { Filesystem } from '../filesystems/index'
import { CommitNotifier } from '../notifiers/index'
import { QueryAdapter } from '../query-adapters/index'
import { SatelliteClient, SatelliteRegistry } from '../satellite/index'
import { proxyOriginal } from '../proxy/original'
import { DbName, DbNamespace } from '../util/types'

// These are the options that should be provided to the adapter's electrify
// entrypoint. They are all optional to optionally allow different / mock
// implementations to be passed in to facilitate testing.
export interface ElectrifyOptions {
  defaultNamespace?: DbNamespace,
  filesystem?: Filesystem,
  notifier?: CommitNotifier,
  queryAdapter?: QueryAdapter,
  satelliteClient?: SatelliteClient,
  satelliteRegistry?: SatelliteRegistry
}

// This is the namespace that's patched onto the user's database client
// (technically via the proxy machinery) as the `.electric` property.
export class ElectricNamespace {
  notifier: CommitNotifier
  queryAdapter: QueryAdapter

  constructor(notifier: CommitNotifier, queryAdapter: QueryAdapter) {
    this.notifier = notifier
    this.queryAdapter = queryAdapter
  }

  // We lift this function a level so the user can call
  // `db.electric.notifyCommit()` rather than the longer / more redundant
  // `db.electric.notifier.notifyCommit()`.
  notifyCommit(): void {
    this.notifier.notifyCommit()
  }
}

// This is the primary `electrify()` endpoint that the individal adapters
// call once they've constructed their implementations. This function can
// also be called directly by tests that don't want to go via the adapter
// entrypoints in order to avoid loading the environment dependencies.
export const electrify = (
      dbName: DbName,
      db: AnyDatabase,
      electric: AnyElectricDatabase,
      client: SatelliteClient,
      fs: Filesystem,
      registry: SatelliteRegistry
    ): Promise<any> => {
  return registry.ensureStarted(dbName, client, fs)
    .then(() => proxyOriginal(db, electric))
}
