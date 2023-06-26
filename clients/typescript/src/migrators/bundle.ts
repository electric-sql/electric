import {
  makeStmtMigration,
  Migration,
  MigrationRecord,
  Migrator,
  MigratorOptions,
  StmtMigration,
} from './index'
import { DatabaseAdapter } from '../electric/adapter'
import { overrideDefined } from '../util/options'
import { data as baseMigration } from './schema'
import Log from 'loglevel'

const DEFAULTS: MigratorOptions = {
  tableName: '_electric_migrations',
}

const VALID_VERSION_EXP = new RegExp('^[0-9_]+$')

export class BundleMigrator implements Migrator {
  adapter: DatabaseAdapter
  migrations: StmtMigration[]

  tableName: string

  constructor(
    adapter: DatabaseAdapter,
    migrations: Migration[] = [],
    tableName?: string
  ) {
    const overrides = { tableName: tableName }
    const opts = overrideDefined(DEFAULTS, overrides) as MigratorOptions

    this.adapter = adapter
    this.migrations = [...baseMigration.migrations, ...migrations].map(
      makeStmtMigration
    )
    this.tableName = opts.tableName
  }

  async up(): Promise<number> {
    const existing = await this.queryApplied()
    const unapplied = await this.validateApplied(this.migrations, existing)

    let migration: StmtMigration
    for (let i = 0; i < unapplied.length; i++) {
      migration = unapplied[i]
      Log.info(`applying migration: ${migration.version}`)
      await this.apply(migration)
    }

    return unapplied.length
  }

  async queryApplied(): Promise<MigrationRecord[]> {
    // If this is the first time we're running migrations, then the
    // migrations table won't exist.
    const tableExists = `
      SELECT 1 FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
    `
    const tables = await this.adapter.query({
      sql: tableExists,
      args: [this.tableName],
    })
    if (tables.length === 0) {
      return []
    }

    // The migrations table exists, so let's query the version of
    // the previously applied migrations.
    const existingRecords = `
      SELECT version FROM ${this.tableName}
        ORDER BY id ASC
    `
    const rows = await this.adapter.query({ sql: existingRecords })
    return rows as unknown as MigrationRecord[]
  }

  async validateApplied(
    migrations: StmtMigration[],
    existing: MigrationRecord[]
  ) {
    // We validate that the existing records are the first migrations.
    existing.forEach(({ version }, i) => {
      const migration = migrations[i]

      if (migration.version !== version) {
        throw new Error(
          `Migrations cannot be altered once applied: expecting ${version} at index ${i}.`
        )
      }
    })

    // Then we can confidently slice and return the non-existing.
    return migrations.slice(existing.length)
  }

  async apply({ statements, version }: StmtMigration): Promise<void> {
    if (!VALID_VERSION_EXP.test(version)) {
      throw new Error(
        `Invalid migration version, must match ${VALID_VERSION_EXP}`
      )
    }

    const applied = `INSERT INTO ${this.tableName}
        ('version', 'applied_at') VALUES (?, ?)
        `

    await this.adapter.runInTransaction(...statements, {
      sql: applied,
      args: [version, Date.now()],
    })
  }

  /**
   * Applies the provided migration only if it has not yet been applied.
   * @param migration The migration to apply.
   * @returns A promise that resolves to a boolean
   *          that indicates if the migration was applied.
   */
  async applyIfNotAlready(migration: StmtMigration): Promise<boolean> {
    const versionExists = `
      SELECT 1 FROM ${this.tableName}
        WHERE version = ?
    `
    const rows = await this.adapter.query({
      sql: versionExists,
      args: [migration.version],
    })

    const shouldApply = rows.length === 0

    if (shouldApply) {
      // This is a new migration because its version number
      // is not in our migrations table.
      await this.apply(migration)
    }

    return shouldApply
  }
}
