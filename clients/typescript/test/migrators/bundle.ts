import { TestFn } from 'ava'

import { makeStmtMigration } from '../../src/migrators'
import { DatabaseAdapter } from '../../src/electric/adapter'
import { Migration } from '../../src/migrators'
import { BundleMigratorBase as BundleMigrator } from '../../src/migrators/bundle'

export type ContextType = {
  dbName: string
  adapter: DatabaseAdapter
  migrations: Migration[]
  BundleMigrator: new (
    adapter: DatabaseAdapter,
    migrations?: Migration[]
  ) => BundleMigrator
  stop: () => Promise<void>
}

export const bundleTests = (test: TestFn<ContextType>) => {
  test('run the bundle migrator', async (t) => {
    const { adapter, BundleMigrator, migrations } = t.context as any

    const migrator = new BundleMigrator(adapter, migrations)
    t.is(await migrator.up(), 3)
    t.is(await migrator.up(), 0)
  })

  test('applyIfNotAlready applies new migrations', async (t) => {
    const { adapter, BundleMigrator, migrations } = t.context as any

    const allButLastMigrations = migrations.slice(0, -1)
    const lastMigration = makeStmtMigration(migrations[migrations.length - 1])

    const migrator = new BundleMigrator(adapter, allButLastMigrations)
    t.is(await migrator.up(), 2)

    const wasApplied = await migrator.applyIfNotAlready(lastMigration)
    t.assert(wasApplied)
  })

  test('applyIfNotAlready ignores already applied migrations', async (t) => {
    const { adapter, BundleMigrator, migrations } = t.context as any

    const migrator = new BundleMigrator(adapter, migrations)
    t.is(await migrator.up(), 3)

    const wasApplied = await migrator.applyIfNotAlready(
      makeStmtMigration(migrations[0])
    )
    t.assert(!wasApplied)
  })
}
