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

  async tauri_init(name: string) {
    this.invoke("tauri_init", { name });
  }

  async tauri_exec(statement: Statement): Promise<QueryExecResult> {
    let [keys, values] = separateBindParams(statement.args)
    let result = await this.invoke("tauri_exec_command", { sql: statement.sql, bind_params: { keys, values } })
    console.log("YYYYYYYY: ", result)
    return result
  }

  async exec(statement: Statement): Promise<QueryExecResult> {
    const release = await this.mutex.acquire()

    let result: any
    try {
      result = await this.tauri_exec(statement);
    } finally {
      release()
    }

    this.rowsModified = result.rows_modified
    let rows: Array<{ [key: string]: any }> = JSON.parse(result.result)

    try {
      const values: SqlValue[][] = []
      let keys: string[] = []

      if (rows.length > 0) {
        keys = Object.keys(rows[0])
      }

      rows.forEach((row) => {
          // let vals = Object.values(row)
          let vals = keys.map(key => row[key])

          for (let i = 0; i < vals.length; i++) {
            if (vals[i][0] == "\u0000") {
                vals[i] = (vals[i].charCodeAt(1) * 2 ** 32 + vals[i].charCodeAt(2) * 2 ** 16 + vals[i].charCodeAt(3) * 1)
            }
            if (vals[i] == "NULL") {
              vals[i] = null
            }
          }
          values.push(vals)
      })

      return {
        columns: keys,
        values: values,
      }
    } finally {
      release()
    }
  }

  getRowsModified() {
    return this.rowsModified;
  }

  async stop() {
    await this.invoke("tauri_stop_postgres").then();
  }

  static async init(dbName: string, invoke: Function) {
    await invoke("tauri_init_command", { name: dbName }).then((result: string) => {
      result
    });
    return new ElectricDatabase(dbName, invoke)
  }
}
