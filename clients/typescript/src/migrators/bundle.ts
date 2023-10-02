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
import { SatelliteError, SatelliteErrorCode } from '../util'


export const SCHEMA_VSN_ERROR_MSG = `Local schema doesn't match server's. Clear local state through developer tools and retry connection manually. If error persists, re-generate the client. Check documentation (https://electric-sql.com/docs/reference/roadmap) to learn more.`

const DEFAULTS: MigratorOptions = {
  tableName: '_electric_migrations',
}

const VALID_VERSION_EXP = new RegExp('^[0-9_]+$')

export class BundleMigrator implements Migrator {
  adapter: DatabaseAdapter
  migrations: StmtMigration[]

  tableName: string
  pg: boolean = false

  constructor(
    adapter: DatabaseAdapter,
    migrations: Migration[] = [],
    pg: boolean = false,
    tableName?: string
  ) {
    this.pg = pg
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

  async migrationsTableExists(): Promise<boolean> {
    // If this is the first time we're running migrations, then the
    // migrations table won't exist.
    let tableExists = `
    SELECT 1 FROM information_schema.tables
      WHERE table_name = $1
    `
    const tables = await this.adapter.query({
      sql: tableExists,
      args: [this.tableName],
    })

    return tables.length > 0
  }

  async queryApplied(): Promise<MigrationRecord[]> {
    if (!(await this.migrationsTableExists())) {
      return []
    }

    const existingRecords = `
    SELECT version FROM main.${this.tableName}
      ORDER BY id ASC
    `

    const rows = await this.adapter.query({ sql: existingRecords })
    return rows as unknown as MigrationRecord[]
  }

  // Returns the version of the most recently applied migration
  async querySchemaVersion(): Promise<string | undefined> {
    if (!(await this.migrationsTableExists())) {
      return
    }

    // The hard-coded version '0' below corresponds to the version of the internal migration defined in `schema.ts`.
    // We're ignoring it because this function is supposed to return the application schema version.
    const schemaVersion = `
    SELECT version FROM main.${this.tableName}
      WHERE version != '0'
      ORDER BY version DESC
      LIMIT 1
    `
    const rows = await this.adapter.query({ sql: schemaVersion })
    if (rows.length === 0) {
      return
    }

    return (rows[0] as MigrationRecord).version
  }

  // TODO: does this need to be converted to PG?
  async validateApplied(
    migrations: StmtMigration[],
    existing: MigrationRecord[],
  ) {
    // We validate that the existing records are the first migrations.
    existing.forEach(({ version }, i) => {
      const migration = migrations[i]
      if (migration.version !== version) {
        throw new SatelliteError(
          SatelliteErrorCode.UNKNOWN_SCHEMA_VSN,
          SCHEMA_VSN_ERROR_MSG
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

    const applied = `
      INSERT INTO main.${this.tableName}(version, applied_at) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING
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
    SELECT 1 FROM main.${this.tableName}
      WHERE version = $1
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
