import { Statement } from '../util'
import { dedent } from 'ts-dedent'
import { QueryBuilder } from './query-builder'

export type ForeignKey = {
  table: string
  childKey: string
  parentKey: string
}

type ColumnName = string
type SQLiteType = string
type PgType = string
type ColumnType = {
  sqliteType: SQLiteType
  pgType: PgType
}
type ColumnTypes = Record<ColumnName, ColumnType>

export type Table = {
  tableName: string
  namespace: string
  columns: ColumnName[]
  primary: ColumnName[]
  foreignKeys: ForeignKey[]
  columnTypes: ColumnTypes
}

type TableFullName = string
type Tables = Map<TableFullName, Table>

function mkStatement(sql: string): Statement {
  return { sql }
}

/**
 * Generates the triggers Satellite needs for the given table.
 * Assumes that the necessary meta tables already exist.
 * @param table - A new or existing table for which to create/update the triggers.
 * @returns An array of SQLite statements that add the necessary oplog triggers.
 *
 * @remarks
 * We return an array of SQL statements because the DB drivers
 * do not accept queries containing more than one SQL statement.
 */
export function generateOplogTriggers(
  table: Omit<Table, 'foreignKeys'>,
  builder: QueryBuilder
): Statement[] {
  const { tableName, namespace, columns, primary, columnTypes } = table

  const newPKs = joinColsForJSON(primary, columnTypes, 'new')
  const oldPKs = joinColsForJSON(primary, columnTypes, 'old')
  const newRows = joinColsForJSON(columns, columnTypes, 'new')
  const oldRows = joinColsForJSON(columns, columnTypes, 'old')

  const [dropFkTrigger, ...createFkTrigger] =
    builder.createOrReplaceNoFkUpdateTrigger(namespace, tableName, primary)
  const [dropInsertTrigger, ...createInsertTrigger] =
    builder.createOrReplaceInsertTrigger(
      namespace,
      tableName,
      newPKs,
      newRows,
      oldRows
    )

  return [
    dedent`
      -- Toggles for turning the triggers on and off
      ${builder.insertOrIgnore(
        'main',
        '_electric_trigger_settings',
        ['namespace', 'tablename', 'flag'],
        [`'${namespace}'`, `'${tableName}'`, '1']
      )}
    `,
    dedent`
    /* Triggers for table ${tableName} */
  
    -- ensures primary key is immutable
    ${dropFkTrigger}
    `,
    ...createFkTrigger,
    dedent`
      -- Triggers that add INSERT, UPDATE, DELETE operation to the oplog table
      ${dropInsertTrigger}
    `,
    ...createInsertTrigger,
    ...builder.createOrReplaceUpdateTrigger(
      namespace,
      tableName,
      newPKs,
      newRows,
      oldRows
    ),
    ...builder.createOrReplaceDeleteTrigger(
      namespace,
      tableName,
      oldPKs,
      newRows,
      oldRows
    ),
  ].map(mkStatement)
}

/**
 * Generates triggers for compensations for all foreign keys in the provided table.
 *
 * Compensation is recorded as a SatOpCompensation messaage. The entire reason
 * for it existing is to maybe revive the row if it has been deleted, so we need
 * correct tags.
 *
 * The compensation update contains _just_ the primary keys, no other columns are present.
 *
 * @param tableFullName Full name of the table.
 * @param table The corresponding table.
 * @param tables Map of all tables (needed to look up the tables that are pointed at by FKs).
 * @returns An array of SQLite statements that add the necessary compensation triggers.
 */
function generateCompensationTriggers(
  table: Table,
  builder: QueryBuilder
): Statement[] {
  const { tableName, namespace, foreignKeys, columnTypes } = table

  const makeTriggers = (foreignKey: ForeignKey) => {
    const { childKey } = foreignKey

    const fkTableNamespace = 'main' // currently, Electric always uses the 'main' namespace
    const fkTableName = foreignKey.table
    const fkTablePK = foreignKey.parentKey // primary key of the table pointed at by the FK.

    // This table's `childKey` points to the parent's table `parentKey`.
    // `joinColsForJSON` looks up the type of the `parentKey` column in the provided `colTypes` object.
    // However, `columnTypes` contains the types of the columns of this table
    // so we need to pass an object containing the column type of the parent key.
    // We can construct that object because the type of the parent key must be the same
    // as the type of the child key that is pointing to it.
    const joinedFkPKs = joinColsForJSON([fkTablePK], {
      [fkTablePK]: columnTypes[foreignKey.childKey],
    })

    const [dropInsertTrigger, ...createInsertTrigger] =
      builder.createOrReplaceInsertCompensationTrigger(
        namespace,
        tableName,
        childKey,
        fkTableNamespace,
        fkTableName,
        joinedFkPKs,
        foreignKey
      )

    return [
      // The compensation trigger inserts a row in `_electric_oplog` if the row pointed at by the FK exists
      // The way how this works is that the values for the row are passed to the nested SELECT
      // which will return those values for every record that matches the query
      // which can be at most once since we filter on the foreign key which is also the primary key and thus is unique.
      dedent`
        -- Triggers for foreign key compensations
        ${dropInsertTrigger}
      `,
      ...createInsertTrigger,
      ...builder.createOrReplaceUpdateCompensationTrigger(
        namespace,
        tableName,
        foreignKey.childKey,
        fkTableNamespace,
        fkTableName,
        joinedFkPKs,
        foreignKey
      ),
    ].map(mkStatement)
  }
  const fkTriggers = foreignKeys.map((fk) => makeTriggers(fk))

  return fkTriggers.flat()
}

/**
 * Generates the oplog triggers and compensation triggers for the provided table.
 * @param tableFullName - Full name of the table for which to create the triggers.
 * @param tables - Dictionary mapping full table names to the corresponding tables.
 * @returns An array of SQLite statements that add the necessary oplog and compensation triggers.
 */
export function generateTableTriggers(
  table: Table,
  builder: QueryBuilder
): Statement[] {
  const oplogTriggers = generateOplogTriggers(table, builder)
  const fkTriggers = generateCompensationTriggers(table, builder)
  return oplogTriggers.concat(fkTriggers)
}

/**
 * Generates triggers for all the provided tables.
 * @param tables - Dictionary mapping full table names to the corresponding tables.
 * @returns An array of SQLite statements that add the necessary oplog and compensation triggers for all tables.
 */
export function generateTriggers(
  tables: Tables,
  builder: QueryBuilder
): Statement[] {
  const tableTriggers: Statement[] = []
  tables.forEach((table) => {
    const triggers = generateTableTriggers(table, builder)
    tableTriggers.push(...triggers)
  })

  const stmts = [
    { sql: 'DROP TABLE IF EXISTS main._electric_trigger_settings;' },
    {
      sql: 'CREATE TABLE main._electric_trigger_settings(namespace TEXT, tablename TEXT, flag INTEGER, PRIMARY KEY(namespace, tablename));',
    },
    ...tableTriggers,
  ]

  return stmts
}

/**
 * Joins the column names and values into a string of pairs of the form `'col1', val1, 'col2', val2, ...`
 * that can be used to build a JSON object in a SQLite `json_object` function call.
 * Values of type REAL are cast to text to avoid a bug in SQLite's `json_object` function (see below).
 * Similarly, values of type INT8 (i.e. BigInts) are cast to text because JSON does not support BigInts.
 *
 * NOTE: There is a bug with SQLite's `json_object` function up to version 3.41.2
 *       that causes it to return an invalid JSON object if some value is +Infinity or -Infinity.
 * @example
 * sqlite> SELECT json_object('a',2e370,'b',-3e380);
 * {"a":Inf,"b":-Inf}
 *
 * The returned JSON is not valid because JSON does not support `Inf` nor `-Inf`.
 * @example
 * sqlite> SELECT json_valid((SELECT json_object('a',2e370,'b',-3e380)));
 * 0
 *
 * This is fixed in version 3.42.0 and on:
 * @example
 * sqlite> SELECT json_object('a',2e370,'b',-3e380);
 * {"a":9e999,"b":-9e999}
 *
 * The returned JSON now is valid, the numbers 9e999 and -9e999
 * are out of range of floating points and thus will be converted
 * to `Infinity` and `-Infinity` when parsed with `JSON.parse`.
 *
 * Nevertheless version SQLite version 3.42.0 is very recent (May 2023)
 * and users may be running older versions so we want to support them.
 * Therefore we introduce the following workaround:
 * @example
 * sqlite> SELECT json_object('a', cast(2e370 as TEXT),'b', cast(-3e380 as TEXT));
 * {"a":"Inf","b":"-Inf"}
 *
 * By casting the values to TEXT, infinity values are turned into their string representation.
 * As such, the resulting JSON is valid.
 * This means that the values will be stored as strings in the oplog,
 * thus, we must be careful when parsing the oplog to convert those values back to their numeric type.
 *
 * For reference:
 * - https://discord.com/channels/933657521581858818/1163829658236760185
 * - https://www.sqlite.org/src/info/b52081d0acd07dc5bdb4951a3e8419866131965260c1e3a4c9b6e673bfe3dfea
 *
 * @param cols The column names
 * @param target The target to use for the column values (new or old value provided by the trigger).
 */
function joinColsForJSON(
  cols: string[],
  colTypes: ColumnTypes,
  target?: 'new' | 'old'
) {
  // casts the value to TEXT if it is of type REAL
  // to work around the bug in SQLite's `json_object` function
  const castIfNeeded = (col: string, targettedCol: string) => {
    const tpes = colTypes[col]
    const sqliteType = tpes.sqliteType
    const pgType = tpes.pgType
    if (sqliteType === 'REAL' || pgType === 'INT8' || pgType === 'BIGINT') {
      return `cast(${targettedCol} as TEXT)`
    } else {
      return targettedCol
    }
  }

  if (typeof target === 'undefined') {
    return cols
      .sort()
      .map((col) => `'${col}', ${castIfNeeded(col, `"${col}"`)}`)
      .join(', ')
  } else {
    return cols
      .sort()
      .map((col) => `'${col}', ${castIfNeeded(col, `${target}."${col}"`)}`)
      .join(', ')
  }
}
