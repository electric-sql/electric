import type { Client, QueryConfig, QueryResult, QueryResultRow } from 'pg'

export type Database = Pick<Client, 'host' | 'port' | 'database'> & {
  query<R extends QueryResultRow = any, I extends any[] = any[]>(
    queryConfig: QueryConfig<I>
  ): Promise<Pick<QueryResult<R>, 'rows' | 'rowCount'>>
}

type StopFn = () => Promise<void>

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

/**
 * Creates and opens a DB backed by Postgres
 */
export async function createEmbeddedPostgres(
  config: PostgresConfig
): Promise<{ db: Database; stop: StopFn }> {
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

  let stopPromise: Promise<void>

  // We use the database directory as the name
  // because it uniquely identifies the DB
  return {
    db,
    stop: () => (stopPromise ??= pg.stop()),
  }
}
