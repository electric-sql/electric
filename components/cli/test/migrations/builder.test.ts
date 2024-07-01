import test from 'ava'
import fs from 'fs/promises'
import path from 'path'
import { buildMigrations } from '../../src/migrations/builder'
import { sqliteBuilder } from 'electric-sql/migrators/query-builder'
import { loadMigrations } from '../../src/migrations/builder'
import { Relation } from 'electric-sql/client/model'

const migrationsFolder = path.join(
  '../../clients/typescript/test/migrators/support/migrations'
)

test('write migration to configuration file and build DB schema', async (t) => {
  // compute absolute path to avoid differences between dynamic import and NodeJS' `fs` module
  const ogMigrationsFile = path.resolve(
    path.join('./test/support/migrations.js')
  )

  // First read the config file and store its contents
  // such that we can restore it later to its original contents
  const ogConfigContents = await fs.readFile(ogMigrationsFile, 'utf8')

  // Make a temporary copy of the config file
  // on which this test will operate
  const testMigrationsFile = path.resolve(
    path.join('./test/support/migrations-tmp.js')
  )
  await fs.writeFile(testMigrationsFile, ogConfigContents)

  // path to config file, relative from this file
  const p = '../support/migrations-tmp.js'

  let i = 0
  const importMigrations = async () =>
    (await import(path.join(p.concat(`?foo=${i++}`)))).default
  const ogMigrations = await importMigrations()
  t.deepEqual(ogMigrations, [])

  const dbDescription = await buildMigrations(
    migrationsFolder,
    testMigrationsFile,
    sqliteBuilder
  )

  // Check that the generated DB description is correct
  t.deepEqual(dbDescription, {
    stars: {
      fields: {
        id: 'TEXT',
        avatar_url: 'TEXT',
        name: 'TEXT',
        starred_at: 'TEXT',
        username: 'TEXT',
      },
      relations: [
        new Relation('beers', '', '', 'beers', 'beers_star_idTostars'),
      ],
    },
    beers: {
      fields: {
        id: 'TEXT',
        star_id: 'TEXT',
      },
      relations: [
        new Relation('stars', 'star_id', 'id', 'stars', 'beers_star_idTostars'),
      ],
    },
  })

  const newMigrations = await importMigrations()
  const versions = newMigrations.map((m: any) => m.version)
  t.deepEqual(versions, ['20230613112725_814', '20230613112735_992'])

  // Delete the temporary config file
  // we created for this test
  await fs.unlink(testMigrationsFile)
})

test('read migration meta data', async (t) => {
  const { migrations, dbDescription } = await loadMigrations(
    migrationsFolder,
    sqliteBuilder
  )
  const versions = migrations.map((m) => m.version)
  t.deepEqual(versions, ['20230613112725_814', '20230613112735_992'])

  t.deepEqual(dbDescription, {
    stars: {
      fields: {
        id: 'TEXT',
        avatar_url: 'TEXT',
        name: 'TEXT',
        starred_at: 'TEXT',
        username: 'TEXT',
      },
      relations: [
        new Relation('beers', '', '', 'beers', 'beers_star_idTostars'),
      ],
    },
    beers: {
      fields: {
        id: 'TEXT',
        star_id: 'TEXT',
      },
      relations: [
        new Relation('stars', 'star_id', 'id', 'stars', 'beers_star_idTostars'),
      ],
    },
  })
})
