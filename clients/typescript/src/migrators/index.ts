import { ForeignKeyChecks } from '../config'
import { Statement } from '../util'
import { QueryBuilder } from './query-builder'

export { SqliteBundleMigrator, PgBundleMigrator } from './bundle'
export { MockMigrator } from './mock'
export { parseMetadata, makeMigration } from './builder'
export type { MetaData } from './builder'

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
  apply(migration: StmtMigration, fkChecks: ForeignKeyChecks): Promise<void>
  applyIfNotAlready(
    migration: StmtMigration,
    fkChecks: ForeignKeyChecks
  ): Promise<boolean>
  querySchemaVersion(): Promise<string | undefined>
  queryBuilder: QueryBuilder
}
