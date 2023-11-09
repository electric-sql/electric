import { Statement } from '../util/index.js'

export { BundleMigrator } from './bundle.js'
export { MockMigrator } from './mock.js'
export { parseMetadata, makeMigration } from './builder.js'
export type { MetaData } from './builder.js'

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
  querySchemaVersion(): Promise<string | undefined>
}

export interface MigratorOptions {
  tableName: string
}
