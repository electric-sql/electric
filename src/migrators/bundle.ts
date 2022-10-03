import { Migrator } from './index'

export class BundleMigrator implements Migrator {
  constructor(_adapter: any, _migrationsPath?: string) {
    // ...
  }
  async up(): Promise<number> {
    return 1
  }
}
