import { Migrator, StmtMigration } from './index'
import { QueryBuilder } from './query-builder'

export class MockMigrator implements Migrator {
  electricQueryBuilder: QueryBuilder = null as any

  async up(): Promise<number> {
    return 1
  }

  async apply(_: StmtMigration): Promise<void> {
    return
  }

  async applyIfNotAlready(_: StmtMigration): Promise<boolean> {
    return true
  }

  async querySchemaVersion(): Promise<string | undefined> {
    return
  }
}
