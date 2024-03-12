import pg from 'pg'
import type { Client } from 'pg'
import EmbeddedPostgres from 'embedded-postgres'
import { Row, Statement } from '../../util'

const originalGetTypeParser = pg.types.getTypeParser

export type QueryResult = {
  rows: Row[]
  rowsModified: number
}

export interface Database {
  name: string
  exec(statement: Statement): Promise<QueryResult>
  stop(): Promise<void>
}

export class ElectricDatabase implements Database {
  // Do not use this constructor directly.
  // Create a Database instance using the static `init` method instead.
  private constructor(
    public name: string,
    private postgres: EmbeddedPostgres,
    private db: Client
  ) {}

  async exec(statement: Statement): Promise<QueryResult> {
    const { rows, rowCount } = await this.db.query<Row>({
      text: statement.sql,
      values: statement.args,
      types: {
        // Modify the parser to not parse JSON values
        // Instead, return them as strings
        // our conversions will correctly parse them
        getTypeParser: ((oid: number) => {
          if (
            oid === pg.types.builtins.JSON ||
            oid === pg.types.builtins.JSONB
          ) {
            return (val) => val
          }
          return originalGetTypeParser(oid)
        }) as typeof pg.types.getTypeParser,
      },
    })
    return {
      rows,
      rowsModified: rowCount ?? 0,
    }
  }

  async stop() {
    await this.postgres.stop()
  }

  // Creates and opens a DB backed by Postgres
  static async init(config: PostgresConfig) {
    // Initialize Postgres
    const pg = new EmbeddedPostgres({
      databaseDir: config.databaseDir,
      user: config.user ?? 'postgres',
      password: config.password ?? 'password',
      port: config.port ?? 54321,
      persistent: config.persistent ?? true,
    })

    await pg.initialise()
    await pg.start()
    await pg.createDatabase(config.name)
    const db = pg.getPgClient()
    await db.connect()

    // We use the database directory as the name
    // because it uniquely identifies the DB
    return new ElectricDatabase(config.databaseDir, pg, db)
  }
}

type PostgresConfig = {
  /**
   * The name of the database.
   */
  name: string
  /**
   * The location where the data should be persisted to.
   */
  databaseDir: string
  /**
   * Default is 'postgres'.
   */
  user?: string
  /**
   * Default is 'password'.
   */
  password?: string
  /**
   * Default is 54321.
   */
  port?: number
  /**
   * When set to fale, the database will be deleted when the DB is stopped.
   * Default is true.
   */
  persistent?: boolean
}
