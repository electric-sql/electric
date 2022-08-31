import { AnyDatabase, AnyElectricDatabase } from '../adapters/index'
import { Filesystem } from '../filesystems/index'
import { CommitNotifier } from '../notifiers/index'
import { QueryAdapter } from '../query-adapters/index'
import { SatelliteDatabaseAdapter, SatelliteRegistry } from '../satellite/index'
import { proxyOriginal } from '../proxy/original'
import { DbName, DbNamespace } from '../util/types'

// These are the options that should be provided to the adapter's electrify
// entrypoint. They are all optional to optionally allow different / mock
// implementations to be passed in to facilitate testing.
export interface ElectrifyOptions {
  defaultNamespace?: DbNamespace,
  filesystem?: Filesystem,
  commitNotifier?: CommitNotifier,
  queryAdapter?: QueryAdapter,
  satelliteDbAdapter?: SatelliteDatabaseAdapter,
  satelliteRegistry?: SatelliteRegistry
}

// This is the namespace that's patched onto the user's database client
// (technically via the proxy machinery) as the `.electric` property.
export class ElectricNamespace {
  commitNotifier: CommitNotifier
  queryAdapter: QueryAdapter

  constructor(commitNotifier: CommitNotifier, queryAdapter: QueryAdapter) {
    this.commitNotifier = commitNotifier
    this.queryAdapter = queryAdapter
  }

  // We lift this function a level so the user can call
  // `db.electric.notifyCommit()` rather than the longer / more redundant
  // `db.electric.notifier.notifyCommit()`.
  notifyCommit(): void {
    this.commitNotifier.notifyCommit()
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
      fs: Filesystem,
      satelliteDbAdapter: SatelliteDatabaseAdapter,
      satelliteRegistry: SatelliteRegistry
    ): Promise<any> => {
  return satelliteRegistry.ensureStarted(dbName, satelliteDbAdapter, fs)
    .then(() => proxyOriginal(db, electric))
}
