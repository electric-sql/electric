// N.b.: importing this module is an entrypoint that imports the better-sqlite3
// environment dependencies. Specifically the node filesystem.
export { DatabaseAdapter } from './adapter.js'
export type { Database } from './database.js'
export { MockDatabase } from './mock.js'
