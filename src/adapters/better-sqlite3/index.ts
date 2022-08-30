// N.b.: importing this module is an entrypoint that imports the better-sqlite3
// environment dependencies. Specifically the node filesystem.
import { DbName } from '../../util/types'

import { DEFAULTS } from '../../electric/config'
import {
  ElectricNamespace,
  ElectrifyOptions,
  electrify as baseElectrify
} from '../../electric/index'

import { NodeFilesystem } from '../../filesystems/node'
import { EmitCommitNotifier } from '../../notifiers/emit'
import { globalRegistry } from '../../satellite/registry'

import { Database, ElectricDatabase } from './database'
import { QueryAdapter } from './query'
import { SatelliteClient } from './satellite'

export const electrify = (db: Database, opts: ElectrifyOptions = {}): Promise<Database> => {
  const dbName: DbName = db.name
  const defaultNamespace = opts.defaultNamespace || DEFAULTS.namespace
  const adapter = opts.queryAdapter || new QueryAdapter(db, defaultNamespace)
  const client = opts.satelliteClient || new SatelliteClient(db)
  const fs = opts.filesystem || new NodeFilesystem()
  const notifier = opts.notifier || new EmitCommitNotifier(dbName)
  const registry = opts.satelliteRegistry || globalRegistry

  const namespace = new ElectricNamespace(notifier, adapter)
  const electric = new ElectricDatabase(db, namespace)

  return baseElectrify(dbName, db, electric, client, fs, registry)
}
