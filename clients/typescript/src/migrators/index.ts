import { Statement } from '../util'

export { BundleMigrator } from './bundle'
export { MockMigrator } from './mock'
export { loadMigrations } from './builder'

export interface Migration {
  statements: string[]
  version: string
}

export interface StmtMigration {
  statements: Statement[]
  version: string
}

export type MigrationRecord = {
  version: string
}

export function makeStmtMigration(migration: Migration): StmtMigration {
  return {
    ...migration,
    statements: migration.statements.map((sql) => ({ sql })),
  }
}

export interface Migrator {
  up(): Promise<number>
  apply(migration: StmtMigration): Promise<void>
  applyIfNotAlready(migration: StmtMigration): Promise<boolean>
}

export interface MigratorOptions {
  tableName: string
}
