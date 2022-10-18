// Generic database clients need to mark themselves with the
// `isGenericDatabase` / `isGenericElectricDatabase` feature.
import { ElectricNamespace } from '../../electric/index'

// Expose so generic drivers can use these.
export { BundleMigrator } from '../../migrators/bundle'
export { EventNotifier } from '../../notifiers/event'
export { globalRegistry } from '../../satellite/registry'

export interface Database {
  isGenericDatabase: true
}

export interface ElectricDatabase {
  isGenericElectricDatabase: true

  electric: ElectricNamespace
}

export interface ElectrifiedDatabase extends Database, ElectricDatabase { }
