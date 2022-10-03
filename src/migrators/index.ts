
export interface Migration {
  body: string,
  encoding: 'escaped', // | 'base64'
  name: string,
  sha256: string,
  title: string
}

export interface MigrationRecord {
  name: string,
  sha256: string
}

export interface Migrator {
  up(): Promise<number>
}

export interface MigratorOptions {
  path: string,
  tableName: string
}
