import {
  makeStmtMigration,
  Migration,
  MigrationRecord,
  Migrator,
  StmtMigration,
} from './index'
import { DatabaseAdapter } from '../electric/adapter'
import { buildInitialMigration as makeBaseMigration } from './schema'
import Log from 'loglevel'
import { QualifiedTablename, SatelliteError, SatelliteErrorCode } from '../util'
import { _electric_migrations } from '../satellite/config'
import { pgBuilder, QueryBuilder, sqliteBuilder } from './query-builder'
import { dedent } from 'ts-dedent'
import { runInTransaction } from '../util/transactions'
import { ForeignKeyChecks } from '../config'

export const SCHEMA_VSN_ERROR_MSG = `Local schema doesn't match server's. Clear local state through developer tools and retry connection manually. If error persists, re-generate the client. Check documentation (https://electric-sql.com/docs/reference/roadmap) to learn more.`

const VALID_VERSION_EXP = new RegExp('^[0-9_]+')

export abstract class BundleMigratorBase implements Migrator {
  adapter: DatabaseAdapter
  migrations: StmtMigration[]

  readonly tableName = _electric_migrations
  readonly migrationsTable: QualifiedTablename

  constructor(
    adapter: DatabaseAdapter,
    migrations: Migration[] = [],
    public queryBuilder: QueryBuilder,
    private namespace: string = queryBuilder.defaultNamespace
  ) {
    this.adapter = adapter
    const baseMigration = makeBaseMigration(queryBuilder)
    this.migrations = [...baseMigration.migrations, ...migrations].map(
      makeStmtMigration
    )
    this.migrationsTable = new QualifiedTablename(
      this.namespace,
      this.tableName
    )
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
    const tableExists = this.queryBuilder.tableExists(this.migrationsTable)
    const tables = await this.adapter.query(tableExists)
    return tables.length > 0
  }

  async queryApplied(): Promise<MigrationRecord[]> {
    if (!(await this.migrationsTableExists())) {
      return []
    }

    const existingRecords = `
      SELECT version FROM ${this.migrationsTable}
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
      SELECT version FROM ${this.migrationsTable}
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

  async validateApplied(
    migrations: StmtMigration[],
    existing: MigrationRecord[]
  ) {
    // `existing` migrations may contain migrations
    // received at runtime that are not bundled in the app
    // i.e. those are not present in `migrations`
    // Thus, `existing` may be longer than `migrations`.
    // So we should only compare a prefix of `existing`
    // that has the same length as `migrations`

    // take a slice of `existing` migrations
    // that will be checked against `migrations`
    const existingPrefix = existing.slice(0, migrations.length)

    // We validate that the existing records are the first migrations.
    existingPrefix.forEach(({ version }, i) => {
      const migration = migrations[i]

      if (migration.version !== version) {
        throw new SatelliteError(
          SatelliteErrorCode.UNKNOWN_SCHEMA_VSN,
          SCHEMA_VSN_ERROR_MSG
        )
      }
    })

    // Then we can confidently slice and return the non-existing.
    return migrations.slice(existingPrefix.length)
  }

  async apply(
    { statements, version }: StmtMigration,
    fkChecks: ForeignKeyChecks = ForeignKeyChecks.inherit
  ): Promise<void> {
    if (!VALID_VERSION_EXP.test(version)) {
      throw new Error(
        `Invalid migration version, must match ${VALID_VERSION_EXP}`
      )
    }

    await runInTransaction(this.adapter, fkChecks, ...statements, {
      sql: dedent`
        INSERT INTO ${this.migrationsTable} (version, applied_at)
        VALUES (${this.queryBuilder.makePositionalParam(
          1
        )}, ${this.queryBuilder.makePositionalParam(2)});
      `,
      args: [version, Date.now().toString()],
    })
  }

  /**
   * Applies the provided migration only if it has not yet been applied.
   * @param migration The migration to apply.
   * @returns A promise that resolves to a boolean
   *          that indicates if the migration was applied.
   */
  async applyIfNotAlready(
    migration: StmtMigration,
    fkChecks: ForeignKeyChecks = ForeignKeyChecks.inherit
  ): Promise<boolean> {
    const rows = await this.adapter.query({
      sql: dedent`
        SELECT 1 FROM ${this.migrationsTable}
          WHERE version = ${this.queryBuilder.makePositionalParam(1)}
      `,
      args: [migration.version],
    })

    const shouldApply = rows.length === 0

    if (shouldApply) {
      // This is a new migration because its version number
      // is not in our migrations table.
      await this.apply(migration, fkChecks)
    }

    return shouldApply
  }
}

export class SqliteBundleMigrator extends BundleMigratorBase {
  constructor(adapter: DatabaseAdapter, migrations: Migration[] = []) {
    super(adapter, migrations, sqliteBuilder)
  }
}

export class PgBundleMigrator extends BundleMigratorBase {
  constructor(adapter: DatabaseAdapter, migrations: Migration[] = []) {
    super(adapter, migrations, pgBuilder)
  }
}
