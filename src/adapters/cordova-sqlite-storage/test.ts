// Safe entrypoint for tests that avoids importing the React Native
// specific dependencies.
import { DbName } from '../../util/types'

import { DEFAULTS } from '../../electric/config'
import { ElectricNamespace, ElectrifyOptions, electrify } from '../../electric/index'

import { MockFilesystem } from '../../filesystems/mock'
import { CommitNotifier } from '../../notifiers/index'
import { MockCommitNotifier } from '../../notifiers/mock'
import { globalRegistry } from '../../satellite/registry'

import { Database, ElectricDatabase } from './database'
import { MockDatabase } from './mock'
import { QueryAdapter } from './query'
import { SatelliteClient } from './satellite'

type RetVal = Promise<[Database, CommitNotifier, Database]>

export const initTestable = (dbName: DbName, opts: ElectrifyOptions = {}): RetVal => {
  const db = new MockDatabase(dbName)

  const adapter = opts.queryAdapter || new QueryAdapter(db, DEFAULTS.namespace)
  const client = opts.satelliteClient || new SatelliteClient(db)
  const fs = opts.filesystem || new MockFilesystem()
  const notifier = opts.notifier || new MockCommitNotifier(dbName)
  const registry = opts.satelliteRegistry || globalRegistry

  const namespace = new ElectricNamespace(notifier, adapter)
  const electric = new ElectricDatabase(db, namespace)

  return electrify(dbName, db, electric, client, fs, registry)
    .then((electrified) => [db, notifier, electrified])
}
