import pg from 'pg'
import { Database } from './database'
import { Row } from '../../util/types'
import { Statement } from '../../util'
import { SerialDatabaseAdapter as GenericDatabaseAdapter } from '../generic'
import { RunResult } from '../../electric/adapter'
import { PgDateType } from '../../client/conversions/types'
import { deserialiseDate } from '../../client/conversions/datatypes/date'

const originalGetTypeParser = pg.types.getTypeParser

export type QueryResult = {
  rows: Row[]
  rowsModified: number
}

export class DatabaseAdapter extends GenericDatabaseAdapter {
  readonly db: Database
  readonly defaultNamespace = 'public'

  constructor(db: Database) {
    super()
    this.db = db
  }

  async _run(statement: Statement): Promise<RunResult> {
    const { rowsModified } = await this.exec(statement)
    return {
      rowsAffected: rowsModified,
    }
  }

  async _query(statement: Statement): Promise<Row[]> {
    const { rows } = await this.exec(statement)
    return rows
  }

  async exec(statement: Statement): Promise<QueryResult> {
    try {
      const { rows, rowCount } = await this.db.query<Row>({
        text: statement.sql,
        values: statement.args,
        types: {
          getTypeParser: ((oid: number) => {
            /*
              // Modify the parser to not parse JSON values
              // Instead, return them as strings
              // our conversions will correctly parse them
              if (
                oid === pg.types.builtins.JSON ||
                oid === pg.types.builtins.JSONB
              ) {
                return (val) => val
              }
              */

            if (
              oid == pg.types.builtins.TIMESTAMP ||
              oid == pg.types.builtins.TIMESTAMPTZ ||
              oid == pg.types.builtins.DATE
            ) {
              // Parse timestamps and date values ourselves
              // because the pg parser parses them differently from what we expect
              const pgTypes = new Map([
                [pg.types.builtins.TIMESTAMP, PgDateType.PG_TIMESTAMP],
                [pg.types.builtins.TIMESTAMPTZ, PgDateType.PG_TIMESTAMPTZ],
                [pg.types.builtins.DATE, PgDateType.PG_DATE],
              ])
              return (val: string) =>
                deserialiseDate(val, pgTypes.get(oid) as PgDateType)
            }
            return originalGetTypeParser(oid)
          }) as typeof pg.types.getTypeParser,
        },
      })
      return {
        rows,
        rowsModified: rowCount ?? 0,
      }
    } catch (e: any) {
      console.log('EXEC ERROR: ' + e.message)
      console.log(
        'STATEMENT was: ' +
          statement.sql +
          ' - args: ' +
          JSON.stringify(statement.args, null, 2)
      )
      throw e
    }
  }
}
