import pg from 'pg'
import type { Client } from 'pg'
import { Row, Statement } from '../../util'

const originalGetTypeParser = pg.types.getTypeParser

export type QueryResult = {
  rows: Row[]
  rowsModified: number
}

export interface Database {
  name: string
  exec(statement: Statement): Promise<QueryResult>
}

export class ElectricDatabase implements Database {
  constructor(
    public name: string,
    //private postgres: EmbeddedPostgres,
    private db: Client
  ) {}

  async exec(statement: Statement): Promise<QueryResult> {
    try {
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
    } catch (e) {
      console.log("EXEC failed: " + JSON.stringify(e) + "\n" + "Statement was: " + JSON.stringify(statement))
      throw e
    }
  }
}

type StopFn = () => Promise<void>

/**
 * Creates and opens a DB backed by Postgres
 */
export async function createEmbeddedPostgres(config: PostgresConfig): Promise<{ db: ElectricDatabase, stop: StopFn }> {
  const EmbeddedPostgres = (await import('embedded-postgres')).default
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
  return {
    db: new ElectricDatabase(config.databaseDir, db),
    stop: () => pg.stop()
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
