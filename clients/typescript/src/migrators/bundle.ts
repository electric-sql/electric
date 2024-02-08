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
import {
  SatelliteError,
  SatelliteErrorCode,
  SqlValue,
  Statement,
} from '../util'
import { ElectricSchema } from './schema'
import {
  Kysely,
  KyselyConfig,
  sql as raw,
  DummyDriver,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  expressionBuilder,
  ExpressionBuilder,
} from 'kysely'
import { _electric_migrations } from '../satellite/config'
import { pgBuilder, QueryBuilder, sqliteBuilder } from './query-builder'

export const SCHEMA_VSN_ERROR_MSG = `Local schema doesn't match server's. Clear local state through developer tools and retry connection manually. If error persists, re-generate the client. Check documentation (https://electric-sql.com/docs/reference/roadmap) to learn more.`

const VALID_VERSION_EXP = new RegExp('^[0-9_]+')

abstract class BundleMigratorBase implements Migrator {
  adapter: DatabaseAdapter
  migrations: StmtMigration[]

  readonly tableName = _electric_migrations
  queryBuilder: Kysely<ElectricSchema>
  eb: ExpressionBuilder<ElectricSchema, typeof _electric_migrations>

  constructor(
    adapter: DatabaseAdapter,
    migrations: Migration[] = [],
    queryBuilderConfig: KyselyConfig,
    electricQueryBuilder: QueryBuilder
  ) {
    this.adapter = adapter
    const baseMigration = makeBaseMigration(electricQueryBuilder)
    this.migrations = [...baseMigration.migrations, ...migrations].map(
      makeStmtMigration
    )
    this.queryBuilder = new Kysely<ElectricSchema>(queryBuilderConfig)
    this.eb = expressionBuilder<ElectricSchema, typeof _electric_migrations>()
  }

  /**
   * Returns a SQL statement that checks if the given table exists.
   * @param namespace The namespace where to check.
   * @param tableName The name of the table to check for existence.
   */
  abstract createTableExistsStatement(
    namespace: string,
    tableName: string
  ): Statement

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
    const tableExists = this.createTableExistsStatement('main', this.tableName)
    const tables = await this.adapter.query(tableExists)
    return tables.length > 0
  }

  async queryApplied(): Promise<MigrationRecord[]> {
    if (!(await this.migrationsTableExists())) {
      return []
    }

    const existingRecords = `
      SELECT version FROM "main"."${this.tableName}"
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
      SELECT version FROM "main"."${this.tableName}"
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

  async apply({ statements, version }: StmtMigration): Promise<void> {
    if (!VALID_VERSION_EXP.test(version)) {
      throw new Error(
        `Invalid migration version, must match ${VALID_VERSION_EXP}`
      )
    }

    const { sql, parameters } = raw`
      INSERT INTO "main".${this.eb.table(
        this.tableName
      )} (version, applied_at) VALUES (${version}, ${Date.now().toString()})
    `.compile(this.queryBuilder)

    await this.adapter.runInTransaction(...statements, {
      sql,
      args: parameters as SqlValue[],
    })
  }

  /**
   * Applies the provided migration only if it has not yet been applied.
   * @param migration The migration to apply.
   * @returns A promise that resolves to a boolean
   *          that indicates if the migration was applied.
   */
  async applyIfNotAlready(migration: StmtMigration): Promise<boolean> {
    const { sql, parameters } = raw`
      SELECT 1 FROM "main".${this.eb.table(this.tableName)}
        WHERE version = ${migration.version}
    `.compile(this.queryBuilder)

    const rows = await this.adapter.query({
      sql,
      args: parameters as SqlValue[],
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

export class SqliteBundleMigrator extends BundleMigratorBase {
  constructor(adapter: DatabaseAdapter, migrations: Migration[] = []) {
    const config: KyselyConfig = {
      dialect: {
        createAdapter: () => new SqliteAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (db) => new SqliteIntrospector(db),
        createQueryCompiler: () => new SqliteQueryCompiler(),
      },
    }
    super(adapter, migrations, config, sqliteBuilder)
  }

  createTableExistsStatement(_namespace: string, tableName: string): Statement {
    return {
      sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
      args: [tableName],
    }
  }
}

export class PgBundleMigrator extends BundleMigratorBase {
  constructor(adapter: DatabaseAdapter, migrations: Migration[] = []) {
    const config: KyselyConfig = {
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (db) => new PostgresIntrospector(db),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    }
    super(adapter, migrations, config, pgBuilder)
  }

  createTableExistsStatement(namespace: string, tableName: string): Statement {
    return {
      sql: `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      args: [namespace, tableName],
    }
  }
}
