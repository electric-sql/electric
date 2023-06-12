//import { Statement } from '../util'

import { Statement } from '../util'

export { BundleMigrator } from './bundle'
export { MockMigrator } from './mock'

/*
export interface Migration {
  satellite_body: string[]
  encoding: string
  name: string
  sha256: string
  title: string
}

export type StmtMigration = Omit<Migration, 'satellite_body'> & {
  satellite_body: Statement[]
}

export function makeStmtMigration(migration: Migration): StmtMigration {
  return {
    ...migration,
    satellite_body: migration.satellite_body.map((sql) => ({ sql })),
  }
}

export interface MigrationRecord {
  name: string
  sha256: string
}
 */

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
}

export interface MigratorOptions {
  tableName: string
}
