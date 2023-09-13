console.log("Trace: We are in the postgres driver");

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
// import { any } from 'zod';
import { BindParams, SqlValue, Statement } from '../../util'
import { QueryExecResult } from '../util/results'

import { Mutex } from 'async-mutex'

import EmbeddedPostgres from 'embedded-postgres';

// const emptyResult = {
//   columns: [],
//   values: [],
// }

function separateBindParams(params: BindParams | undefined): [SqlValue[], string[]] {
  if (typeof params === "undefined") {
    return [[], []]
  }
  if (Array.isArray(params)) {
    // If params is an array of SqlValue, return it and an empty string array
    return [params, []];
  } else {
    // If params is a Row, convert it into two arrays
    const sqlValues: SqlValue[] = [];
    const keys: string[] = [];

    for (const key in params) {
      if (params.hasOwnProperty(key)) {
        keys.push(key);
        sqlValues.push(params[key]);
      }
    }

    return [sqlValues, keys];
  }
}

export interface Database {
  name: string
  exec(statement: Statement): Promise<QueryExecResult>
  getRowsModified(): number
  stop(): void
}

export class ElectricDatabase implements Database {
  mutex: Mutex

  // Do not use this constructor directly.
  // Create a Database instance using the static `init` method instead.
  private constructor(
    public name: string,
    private postgres: any,
    private db: any
  ) {
    this.mutex = new Mutex()
  }

  async exec(statement: Statement): Promise<QueryExecResult> {
    // Uses a mutex to ensure that the execution of SQL statements is not interleaved
    // otherwise wa-sqlite may encounter problems such as indices going out of bounds
    console.log(statement)
    const release = await this.mutex.acquire()

    let result: any
    try {
      result = await this.db.query(statement.sql, separateBindParams(statement.args)[0])
    } finally {
      release()
    }

    console.log(result)

    let rows: SqlValue[][] = []
    let cols: string[] = []

    // TODO: fill in the gaps here.
    let fields = result["fields"].filter((field: any) => field.columnID !== 0)
    cols = fields.length > 0 ? fields.map((field: any) => field.name) : []

    console.log(cols)

    rows = cols.map(column => {
      return result["rows"].map((row: any) => {
        return <SqlValue>row[column]
      })
    })
    // TODO: fill in the gaps here.

    console.log({
      columns: cols,
      values: rows,
    })

    return {
      columns: cols,
      values: rows,
    }

  }

  getRowsModified() {
    // this.invoke("tauri_getRowsModified");
    // return this.sqlite3.changes(this.db)
    return 0; //TODO: fix this
  }

  async stop() {
    await this.postgres.stop()
  }

  // Creates and opens a DB backed by Postgres
  static async init(databaseDir: string) {
    // Initialize SQLite
    const pg = new EmbeddedPostgres({
      databaseDir: databaseDir,
      user: 'postgres',
      password: 'password',
      port: 54321,
      persistent: false,
    });

    await pg.initialise();
    await pg.start();
    await pg.createDatabase('electric');
    // await pg.dropDatabase('TEST');
    const db = pg.getPgClient();
    await db.connect();

    // await pg.stop();

    return new ElectricDatabase(databaseDir,
      pg,
      db)
  }
}
