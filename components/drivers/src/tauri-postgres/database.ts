import { Row, Statement } from '../util/types.js'

export type QueryResult = {
  rows: Row[]
  rowsModified: number
}

type TauriQueryResult = {
  result: string
  rows_modified: number
}

type TauriInvokeFn = (cmd: string, params?: object) => Promise<any>

export interface Database {
  name: string
  exec(statement: Statement): Promise<QueryResult>
  stop(): Promise<void>
}

export class ElectricDatabase implements Database {
  // Do not use this constructor directly.
  // Create a Database instance using the static `init` method instead.
  private constructor(public name: string, private invoke: TauriInvokeFn) {}

  private tauriExec(statement: Statement): Promise<TauriQueryResult> {
    return this.invoke('tauri_exec_command', {
      sql: statement.sql,
      values: statement.args ?? [],
    })
  }

  async exec(statement: Statement): Promise<QueryResult> {
    const { result, rows_modified: rowsModified } = await this.tauriExec(
      statement
    )
    const rows = JSON.parse(result, (_key: any, val: string) => {
      // The values are strings because they were serialized
      // in order to send them from the Rust backend to here
      if (val[0] === '\u0000') {
        // transforms an integer from its string rerpesentation as four code points into an actual int
        return (
          val.charCodeAt(1) * 2 ** 32 +
          val.charCodeAt(2) * 2 ** 16 +
          val.charCodeAt(3) * 1
        )
      }
      if (val === 'NULL') {
        return null
      }
      return val
    })
    return {
      rows,
      rowsModified,
    }
  }

  async stop(): Promise<void> {
    await this.invoke('tauri_stop_postgres')
  }

  static async init(dbName: string, invoke: TauriInvokeFn) {
    await invoke('tauri_init_command', { name: dbName })
    return new ElectricDatabase(dbName, invoke)
  }
}
