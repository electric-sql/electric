import test from 'ava'
import fs from 'fs/promises'
import path from 'path'
import { buildMigrations } from '../../../src/cli/migrations/builder'
import { sqliteBuilder } from '../../../src/migrators/query-builder'

const migrationsFolder = path.join('./test/migrators/support/migrations')

test('write migration to configuration file', async (t) => {
  // compute absolute path to avoid differences between dynamic import and NodeJS' `fs` module
  const ogMigrationsFile = path.resolve(
    path.join('./test/cli/support/migrations.js')
  )

  // First read the config file and store its contents
  // such that we can restore it later to its original contents
  const ogConfigContents = await fs.readFile(ogMigrationsFile, 'utf8')

  // Make a temporary copy of the config file
  // on which this test will operate
  const testMigrationsFile = path.resolve(
    path.join('./test/cli/support/migrations-tmp.js')
  )
  await fs.writeFile(testMigrationsFile, ogConfigContents)

  // path to config file, relative from this file
  const p = '../support/migrations-tmp.js'

  let i = 0
  const importMigrations = async () =>
    (await import(path.join(p.concat(`?foo=${i++}`)))).default
  const ogMigrations = await importMigrations()
  t.deepEqual(ogMigrations, [])

  await buildMigrations(migrationsFolder, testMigrationsFile, sqliteBuilder)
  const newMigrations = await importMigrations()
  const versions = newMigrations.map((m: any) => m.version)
  t.deepEqual(versions, ['20230613112725_814', '20230613112735_992'])

  // Delete the temporary config file
  // we created for this test
  await fs.unlink(testMigrationsFile)
  //await fs.unlink('./test/cli/support/migrations-tmp.js')
})
