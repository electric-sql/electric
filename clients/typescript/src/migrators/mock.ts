import { Migrator } from './index'

export class MockMigrator implements Migrator {
  async up(): Promise<number> {
    return 1
  }
}
