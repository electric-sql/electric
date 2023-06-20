import test from 'ava'
import fs from 'fs/promises'
import path from 'path'
import { buildMigrations } from '../../src/cli'

const migrationsFolder = path.join('./test/migrators/support/migrations')

test('write migration to configuration file', async (t) => {
  // compute absolute path to avoid differences between dynamic import and NodeJS' `fs` module
  const ogConfigFile = path.resolve(
    path.join('./test/cli/support/config/index.mjs')
  )

  // First read the config file and store its contents
  // such that we can restore it later to its original contents
  const ogConfigContents = await fs.readFile(ogConfigFile, 'utf8')

  // Make a temporary copy of the config file
  // on which this test will operate
  const testConfigFile = path.resolve(
    path.join('./test/cli/support/config/index-tmp.mjs')
  )
  await fs.writeFile(testConfigFile, ogConfigContents)

  // path to config file, relative from this file
  const p = '../cli/support/config/index-tmp.mjs'

  let i = 0
  const importConfig = async () =>
    (await import(path.join(p.concat(`?foo=${i++}`)))).default
  const ogConfig = await importConfig()

  await buildMigrations(migrationsFolder, testConfigFile)
  const newConfig = await importConfig()
  const versions = newConfig.migrations.map((m: any) => m.version)
  t.deepEqual(versions, ['20230613112725_814', '20230613112735_992'])

  // Check that apart from the migrations,
  // the rest of the configuration file remains untouched
  delete ogConfig['migrations']
  delete newConfig['migrations']
  t.deepEqual(ogConfig, newConfig)

  // Delete the temporary config file
  // we created for this test
  await fs.unlink(testConfigFile)
  await fs.unlink('./test/cli/support/config/index-tmp.js')
})
