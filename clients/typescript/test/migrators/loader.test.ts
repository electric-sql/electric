import test from 'ava'
import {
  loadMigrations,
  makeMigration,
  parseMetadata,
  writeMigrationsToConfigFile,
} from '../../src/migrators/loader'
import Database from 'better-sqlite3'
import { electrify } from '../../src/drivers/better-sqlite3'
import fs from 'fs/promises'
import path from 'path'
import { DbSchema } from '../../src/client/model'

const migrationMetaData = {
  format: 'SatOpMigrate',
  ops: [
    'GocBCgVzdGFycxISCgJpZBIEVEVYVBoGCgR0ZXh0EhoKCmF2YXRhcl91cmwSBFRFWFQaBgoEdGV4dBIUCgRuYW1lEgRURVhUGgYKBHRleHQSGgoKc3RhcnJlZF9hdBIEVEVYVBoGCgR0ZXh0EhgKCHVzZXJuYW1lEgRURVhUGgYKBHRleHQiAmlkChIyMDIzMDYxMzExMjcyNV84MTQS1QES0gFDUkVBVEUgVEFCTEUgInN0YXJzIiAoCiAgImlkIiBURVhUIE5PVCBOVUxMLAogICJhdmF0YXJfdXJsIiBURVhUIE5PVCBOVUxMLAogICJuYW1lIiBURVhULAogICJzdGFycmVkX2F0IiBURVhUIE5PVCBOVUxMLAogICJ1c2VybmFtZSIgVEVYVCBOT1QgTlVMTCwKICBDT05TVFJBSU5UICJzdGFyc19wa2V5IiBQUklNQVJZIEtFWSAoImlkIikKKSBXSVRIT1VUIFJPV0lEOwo=',
  ],
  protocol_version: 'Electric.Satellite.v1_3',
  version: '20230613112725_814',
}

test('parse migration meta data', (t) => {
  const metaData = parseMetadata(migrationMetaData)
  t.assert(metaData.ops[0].table?.name === 'stars')
  t.assert(metaData.ops[0].table?.columns.length === 5)
})

test('generate migration from meta data', (t) => {
  const metaData = parseMetadata(migrationMetaData)
  const migration = makeMigration(metaData)
  t.assert(migration.version === migrationMetaData.version)
  t.assert(
    migration.statements[0],
    'CREATE TABLE "stars" (\n  "id" TEXT NOT NULL,\n  "avatar_url" TEXT NOT NULL,\n  "name" TEXT,\n  "starred_at" TEXT NOT NULL,\n  "username" TEXT NOT NULL,\n  CONSTRAINT "stars_pkey" PRIMARY KEY ("id")\n) WITHOUT ROWID;\n'
  )
  t.assert(
    migration.statements[3],
    "\n    CREATE TRIGGER update_ensure_main_stars_primarykey\n      BEFORE UPDATE ON main.stars\n    BEGIN\n      SELECT\n        CASE\n          WHEN old.id != new.id THEN\n\t\tRAISE (ABORT, 'cannot change the value of column id as it belongs to the primary key')\n        END;\n    END;\n    "
  )
})

const migrationsFolder = path.join('./test/migrators/support/migrations')

test('read migration meta data', async (t) => {
  const migrations = await loadMigrations(migrationsFolder)
  const versions = migrations.map((m) => m.version)
  t.deepEqual(versions, ['20230613112725_814', '20230613112735_992'])
})

test('write migration to configuration file', async (t) => {
  // Since the `configFile` is dynamically imported by `src/migrators/loader.ts`
  // the path must be relative to the path of that file
  const configFile = path.join(
    './test/migrators/support/.electric/@config/index.js'
  )

  // First read the config file and store its contents
  // such that we can restore the file to its original
  // contents at the end of the test.
  const ogConfigContents = await fs.readFile(configFile, 'utf8')

  // path to config file, relative from this file
  const p = '../migrators/support/.electric/@config/index.js'
  let i = 0
  // JS caches imported modules, so if we reload the configuration file
  // after it got changed by `writeMigrationsToConfigFile` we will get
  // the original config back and not the modified config.
  // Therefore, we trick JS into thinking it is a different module
  // by adding a dummy query parameter that is different each time.
  const importConfig = async () =>
    (await import(path.join(p.concat(`?foo=${i++}`)))).default
  const ogConfig = await importConfig()

  await writeMigrationsToConfigFile(migrationsFolder, configFile)
  const newConfig = await importConfig()
  const versions = newConfig.migrations.map((m: any) => m.version)
  t.deepEqual(versions, ['20230613112725_814', '20230613112735_992'])

  // Check that apart from the migrations,
  // the rest of the configuration file remains untouched
  delete ogConfig['migrations']
  delete newConfig['migrations']
  t.deepEqual(ogConfig, newConfig)

  // Restore original contents of the config file
  await fs.writeFile(configFile, ogConfigContents)
})

test('load migration from meta data', async (t) => {
  const db = new Database(':memory:')
  const migration = makeMigration(parseMetadata(migrationMetaData))
  const electric = await electrify(db, new DbSchema({}), {
    app: 'migration-loader-test',
    env: 'env',
    migrations: [migration],
  })

  // Check that the DB is initialized with the stars table
  const tables = await electric.db.raw({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='stars';`,
  })

  const starIdx = tables.findIndex((tbl) => tbl.name === 'stars')
  t.assert(starIdx >= 0) // must exist

  const columns = await electric.db
    .raw({
      sql: `PRAGMA table_info(stars);`,
    })
    .then((columns) => columns.map((column) => column.name))

  t.deepEqual(columns, ['id', 'avatar_url', 'name', 'starred_at', 'username'])
})
