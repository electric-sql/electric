console.log("Trace: We are in the postgres driver");

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
import { BindParams, SqlValue, Statement } from '../../util'
import { QueryExecResult } from '../util/results'

import { Mutex } from 'async-mutex'

import EmbeddedPostgres from 'embedded-postgres';

function separateBindParams(params: BindParams | undefined): [SqlValue[], string[]] {
  if (typeof params === "undefined") {
    return [[], []]
  }
  if (Array.isArray(params)) {
    return [params, []];
  } else {
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
  rowsModified: number = 0

  // Do not use this constructor directly.
  // Create a Database instance using the static `init` method instead.
  private constructor(
    public name: string,
    private postgres: any,
    private db: any,
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

    if (['INSERT','UPDATE', 'DELETE'].includes(result.command)) { // TODO: this list is incomplete, but these are the big ones. Check UPSERT in sqlite
      this.rowsModified = result.rowCount ?? 0
    }
    console.log(result)

    // let rows: SqlValue[][] = []
    let cols: string[] = []

    let rowCount = result["rowCount"] ?? 0
    let fields = result["fields"].filter((field: any) => field.columnID !== 0)

    if (rowCount === 0) {
      cols = fields.length > 0 ? fields.map((field: any) => field.name) : []
    } else {
      cols = result["fields"].map((field: any) => field.name)
    }

    console.log(cols)

    // rows = cols.map(column => {
    //   return result["rows"].map((row: any) => {
    //     return <SqlValue>row[column]
    //   })
    // })

    const rows: SqlValue[][] = [];

    // cols.forEach(column => {
    //   const transposedColumn: SqlValue[] = result["rows"].map((row: any) => {
    //     return <SqlValue>row[column];
    //   });
    //   rows.push(transposedColumn);
    // });

    for (let i = 0; i < result["rows"].length; i++) {
      let column = [];
      for (let j = 0; j < cols.length; j++) {
        column.push(result["rows"][i][cols[j]])
      }
      rows.push(column)
    }

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
    return this.rowsModified;
  }

  async stop() {
    await this.postgres.stop()
  }

  // Creates and opens a DB backed by Postgres
  static async init(databaseDir: string) {
    // Initialize Postgres
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
