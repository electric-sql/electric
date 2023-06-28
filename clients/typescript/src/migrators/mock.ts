import { Migrator, StmtMigration } from './index'

export class MockMigrator implements Migrator {
  async up(): Promise<number> {
    return 1
  }

  async apply(_: StmtMigration): Promise<void> {
    return
  }

  async applyIfNotAlready(_: StmtMigration): Promise<boolean> {
    return true
  }
}
