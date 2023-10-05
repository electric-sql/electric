console.log("Trace: We are in the sqlx driver");

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { separateBindParams, SqlValue, Statement } from '../../util'
import { QueryExecResult } from '../util/results'

import { Mutex } from 'async-mutex'

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
    private invoke: Function,
  ) {
    this.mutex = new Mutex()
  }

  async test_tauri(name: SqlValue) {
    this.invoke("test_tauri", { name });
  }

  async tauri_init(name: string) {
    this.invoke("tauri_init", { name });
  }

  async tauri_exec(statement: Statement): Promise<QueryExecResult> {
    let [keys, values] = separateBindParams(statement.args);

    return await this.invoke("tauri_exec_command", { sql: statement.sql, bind_params: { keys, values } });
  }

  async exec(statement: Statement): Promise<QueryExecResult> {
    console.log("Trace: sqlx exec called with ", statement)
    const release = await this.mutex.acquire()

    let result: any
    try {
      result = await this.tauri_exec(statement);
    } finally {
      release()
    }

    console.log("XXX: ", result)
    this.rowsModified = result.rows_modified
    let rows: Array<Object> = JSON.parse(result.result)
    console.log(rows)


    try {
      const values: SqlValue[][] = []
      let keys: string[] = []

      if (rows.length > 0) {
        keys = Object.keys(rows[0])
      }

      rows.forEach((row) => {
          let vals = Object.values(row)
          for (let i = 0; i < vals.length; i++) {
            if (vals[i][0] == "\u0000") {
                vals[i] = (vals[i].charCodeAt(1) * 2 ** 32 + vals[i].charCodeAt(2) * 2 ** 16 + vals[i].charCodeAt(3) * 1)
            }
          }
          values.push(vals)
      })

      console.log(keys)
      console.log(values)

      return {
        columns: keys,
        values: values,
      }
    } finally {
      release()
    }
  }

  getRowsModified() {
    return this.invoke("tauri_getRowsModified");
  }

  async stop() {
    console.log("Trace: sqlx stop")
  }

  static async init(dbName: string, invoke: Function) {
    console.log("JSTrace: init", dbName)
    await invoke("tauri_init_command", { name: dbName }).then((result: string) => console.log(result));
    return new ElectricDatabase(dbName, invoke)
  }
}
