import { Migrator, StmtMigration } from './index'
import { QueryBuilder } from './query-builder'

export class MockMigrator implements Migrator {
  queryBuilder: QueryBuilder = null as any

  async up(): Promise<number> {
    return 1
  }

  async apply(_: StmtMigration, _disableFks?: boolean): Promise<void> {
    return
  }

  async applyIfNotAlready(
    _: StmtMigration,
    _disableFks: boolean | undefined
  ): Promise<boolean> {
    return true
  }

  async querySchemaVersion(): Promise<string | undefined> {
    return
  }
}
