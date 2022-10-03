import { Migration, MigrationRecord, Migrator, MigratorOptions } from './index'
import { DatabaseAdapter } from '../electric/adapter'
import { overrideDefined } from '../util/options'

const DEFAULTS: MigratorOptions = {
  path: './migrations',
  tableName: '_electric_migrations'
}

const VALID_NAME_EXP = new RegExp('^[a-z0-9_]+$', 'i')
const VALID_SHA256_EXP = new RegExp('^[a-z0-9]{64}$')

export class BundleMigrator implements Migrator {
  adapter: DatabaseAdapter

  path: string
  tableName: string

  constructor(adapter: DatabaseAdapter, path?: string, tableName?: string) {
    const overrides = {path: path, tableName: tableName}
    const opts = overrideDefined(DEFAULTS, overrides) as MigratorOptions

    this.adapter = adapter
    this.path = opts.path.endsWith('/') ? opts.path.slice(0, -1) : opts.path
    this.tableName = opts.tableName
  }

  async up(): Promise<number> {
    const migrations = await this.loadMigrations()
    const existing = await this.queryApplied()
    const unapplied = await this.validateApplied(migrations, existing)

    unapplied.forEach(async (migration) => {
      await this.apply(migration)
    })

    return unapplied.length
  }

  async loadMigrations(): Promise<Migration[]> {
    const { data: { migrations } } = await import(`${this.path}/index.js`)

    return migrations
  }

  async queryApplied(): Promise<MigrationRecord[]> {
    // If this is the first time we're runnign migrations, then the
    // migrations table won't exist.
    const tableExists = `
      SELECT count(name) as numTables FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
    `
    const [{ numTables }] = await this.adapter.query(tableExists, [this.tableName])
    if (numTables == 0) {
      return []
    }

    // The migrations table exists, so let's query the name and hash of
    // the previously applied migrations.
    const existingRecords = `
      SELECT name, sha256 FROM ${this.tableName}
        ORDER BY id ASC
    `
    const rows = await this.adapter.query(existingRecords)
    return rows as unknown as MigrationRecord[]
  }

  async validateApplied(migrations: Migration[], existing: MigrationRecord[]) {
    // First we validate that the existing records are the first migrations.
    existing.forEach(({ name, sha256 }, i) => {
      const migration = migrations[i]

      if (migration.name !== name) {
        throw new Error(`Migrations cannot be altered once applied: expecting ${name} at index ${i}.`)
      }

      if (migration.sha256 !== sha256) {
        throw new Error(`Migrations cannot be altered once applied: expecting ${name} to have sha256 of ${sha256}`)
      }
    })

    // Then we can confidently slice and return the non-existing.
    return migrations.slice(existing.length)
  }

  async apply({ body, name, sha256 }: Migration): Promise<void> {
    if (!VALID_NAME_EXP.test(name)) {
      throw new Error(`Invalid migration name, must match ${VALID_NAME_EXP}`)
    }

    if (!VALID_SHA256_EXP.test(sha256)) {
      throw new Error(`Invalid migration sha256, must match ${VALID_SHA256_EXP}`)
    }

    const ts = Date.now()
    const sql = `
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
        ${body};

        INSERT INTO ${this.tableName}
          ('name', 'sha256', 'applied_at')
        VALUES
          ('${name}', '${sha256}', '${ts}');
      COMMIT;
      PRAGMA defer_foreign_keys = OFF;
    `

    return this.adapter.run(sql)
  }
  async up(): Promise<number> {
    return 1
  }
}
