import {ExecutionContext} from "ava/entrypoints";
import {mkdir, rm as removeFile} from "node:fs/promises";
import {randomValue} from "../../src/util";
import Database from "better-sqlite3";
import {DatabaseAdapter} from "../../src/drivers/better-sqlite3";
import {BundleMigrator} from "../../src/migrators";
import {MockNotifier} from "../../src/notifiers";
import {MockSatelliteClient} from "../../src/satellite/mock";
import {MockConsoleClient} from "../../src/auth/mock";
import {SatelliteProcess} from "../../src/satellite";
import {initTableInfo} from "../support/satellite-helpers";
import {SatelliteConfig, satelliteDefaults, SatelliteOpts} from "../../src/satellite/config";

export const relations = {
  child: {
    id: 0,
    schema: 'public',
    table: 'child',
    tableType: 0,
    columns: [
      {
        name: 'id',
        type: 'INTEGER',
        primaryKey: true,
      },
      {
        name: 'parent',
        type: 'INTEGER',
        primaryKey: false,
      },
    ],
  },
  parent: {
    id: 1,
    schema: 'public',
    table: 'parent',
    tableType: 0,
    columns: [
      {
        name: 'id',
        type: 'INTEGER',
        primaryKey: true,
      },
      {
        name: 'value',
        type: 'TEXT',
        primaryKey: false,
      },
      {
        name: 'other',
        type: 'INTEGER',
        primaryKey: false,
      },
    ],
  },
}

import config from '../support/.electric/@config/index'
const { migrations } = config

// Speed up the intervals for testing.
export const opts = Object.assign({}, satelliteDefaults, {
  minSnapshotWindow: 40,
  pollingInterval: 200,
})

const satelliteConfig: SatelliteConfig = {
  app: 'test',
  env: 'default',
}

type Opts = SatelliteOpts & {
  minSnapshotWindow: number
  pollingInterval: number
}

export const makeContext = async (t: ExecutionContext<unknown>, options: Opts = opts) => {
  await mkdir('.tmp', { recursive: true })
  const dbName = `.tmp/test-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)
  const migrator = new BundleMigrator(adapter, migrations)
  const notifier = new MockNotifier(dbName)
  const client = new MockSatelliteClient()
  const console = new MockConsoleClient()
  const satellite = new SatelliteProcess(
    dbName,
    adapter,
    migrator,
    notifier,
    client,
    console,
    satelliteConfig,
    options
  )

  const tableInfo = initTableInfo()
  const timestamp = new Date().getTime()

  const runMigrations = async () => {
    await migrator.up()
  }

  t.context = {
    dbName,
    db,
    adapter,
    migrator,
    notifier,
    client,
    runMigrations,
    satellite,
    tableInfo,
    timestamp,
  }
}

export const stopSatellite = async (t: ExecutionContext<unknown>) => {
  const { dbName } = t.context as any

  await removeFile(dbName, { force: true })
  await removeFile(`${dbName}-journal`, { force: true })
}

export const stopSatelliteAndClean = async (t: ExecutionContext<unknown>) => {
  await stopSatellite(t)
  await t.context.satellite.stop()
}
