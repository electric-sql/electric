export { BundleMigrator } from './bundle'
export { MockMigrator } from './mock'

export interface Migration {
  satellite_body: string[]
  encoding: string
  name: string
  sha256: string
  title: string
}

export interface MigrationRecord {
  name: string
  sha256: string
}

export interface Migrator {
  up(): Promise<number>
}

export interface MigratorOptions {
  tableName: string
}
