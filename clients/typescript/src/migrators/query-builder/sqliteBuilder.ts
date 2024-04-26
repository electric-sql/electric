import { dedent } from 'ts-dedent'
import { QualifiedTablename, SqlValue, Statement } from '../../util'
import { QueryBuilder } from './builder'
import { ForeignKey } from '../triggers'

class SqliteBuilder extends QueryBuilder {
  readonly dialect = 'SQLite'
  readonly AUTOINCREMENT_PK = 'INTEGER PRIMARY KEY AUTOINCREMENT'
  readonly BLOB = 'BLOB'
  readonly deferForeignKeys = 'PRAGMA defer_foreign_keys = ON;'
  readonly getVersion = 'SELECT sqlite_version() AS version'
  readonly maxSqlParameters = 65535
  readonly paramSign = '?'
  readonly defaultNamespace = 'main'
  readonly metaTables = [
    'sqlite_schema',
    'sqlite_sequence',
    'sqlite_temp_schema',
  ]

  readonly disableForeignKeys = 'PRAGMA foreign_keys = OFF;'

  pgOnly(_query: string) {
    return ''
  }

  pgOnlyQuery(_query: string) {
    return []
  }

  sqliteOnly(query: string) {
    return query
  }

  sqliteOnlyQuery(query: string) {
    return [query]
  }

  tableExists(tableName: string, _namespace?: string): Statement {
    return {
      sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
      args: [tableName],
    }
  }

  countTablesIn(countName: string, tables: string[]): Statement {
    const sql = dedent`
      SELECT count(name) as ${countName} FROM sqlite_master
        WHERE type='table'
        AND name IN (${tables.map(() => '?').join(', ')})
    `
    return {
      sql,
      args: tables,
    }
  }

  toHex(column: string): string {
    return `hex(${column})`
  }

  hexValue(hexString: string): string {
    return `x'${hexString}'`
  }

  getTableInfo(tablename: string): Statement {
    return {
      sql: `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)`,
      args: [tablename],
    }
  }

  createIndex(
    indexName: string,
    onTable: QualifiedTablename,
    columns: string[]
  ) {
    const namespace = onTable.namespace
    const tablename = onTable.tablename
    return `CREATE INDEX IF NOT EXISTS ${namespace}.${indexName} ON ${tablename} (${columns.join(
      ', '
    )})`
  }

  getLocalTableNames(notIn: string[] = []): Statement {
    const ignore = this.metaTables.concat(notIn)
    const tables = `
      SELECT name FROM sqlite_master
        WHERE type = 'table' AND
              name NOT IN (${ignore.map(() => '?').join(',')})
    `
    return {
      sql: tables,
      args: ignore,
    }
  }

  insertOrIgnore(
    table: string,
    columns: string[],
    values: SqlValue[],
    schema: string = this.defaultNamespace
  ): Statement {
    return {
      sql: dedent`
        INSERT OR IGNORE INTO ${schema}.${table} (${columns.join(', ')})
          VALUES (${columns.map(() => '?').join(', ')});
      `,
      args: values,
    }
  }

  insertOrReplace(
    table: string,
    columns: string[],
    values: Array<SqlValue>,
    _conflictCols: string[],
    _updateCols: string[],
    schema: string = this.defaultNamespace
  ): Statement {
    return {
      sql: dedent`
        INSERT OR REPLACE INTO ${schema}.${table} (${columns.join(', ')})
        VALUES (${columns.map(() => '?').join(', ')})
      `,
      args: values,
    }
  }

  insertOrReplaceWith(
    table: string,
    columns: string[],
    values: Array<SqlValue>,
    conflictCols: string[],
    updateCols: string[],
    updateVals: SqlValue[],
    schema: string = this.defaultNamespace
  ): Statement {
    const { sql: baseSql, args } = this.insertOrReplace(
      table,
      columns,
      values,
      conflictCols,
      updateCols,
      schema
    )
    return {
      sql:
        baseSql +
        ` ON CONFLICT DO UPDATE SET ${updateCols
          .map((col) => `${col} = ?`)
          .join(', ')}`,
      args: args!.concat(updateVals),
    }
  }

  batchedInsertOrReplace(
    table: string,
    columns: string[],
    records: Array<Record<string, SqlValue>>,
    _conflictCols: string[],
    _updateCols: string[],
    maxSqlParameters: number,
    schema: string = this.defaultNamespace
  ): Statement[] {
    const baseSql = `INSERT OR REPLACE INTO ${schema}.${table} (${columns.join(
      ', '
    )}) VALUES `
    return this.prepareInsertBatchedStatements(
      baseSql,
      columns,
      records,
      maxSqlParameters
    )
  }

  dropTriggerIfExists(
    triggerName: string,
    _tablename: string,
    _namespace?: string
  ) {
    return `DROP TRIGGER IF EXISTS ${triggerName};`
  }

  createNoFkUpdateTrigger(
    tablename: string,
    pk: string[],
    namespace: string = this.defaultNamespace
  ): string[] {
    return [
      dedent`
        CREATE TRIGGER update_ensure_${namespace}_${tablename}_primarykey
          BEFORE UPDATE ON "${namespace}"."${tablename}"
        BEGIN
          SELECT
            CASE
              ${pk
                .map(
                  (col) =>
                    `WHEN old."${col}" != new."${col}" THEN\n\t\tRAISE (ABORT, 'cannot change the value of column ${col} as it belongs to the primary key')`
                )
                .join('\n')}
            END;
        END;
      `,
    ]
  }

  createJsonObject(rows: string) {
    return `json_object(${rows})`
  }

  // removes null values from the JSON
  // to be consistent with PG behaviour
  removeSpaceAndNullValuesFromJson(json: string): string {
    return `json_patch('{}', ${json})`
  }

  createPKJsonObject(rows: string) {
    return this.removeSpaceAndNullValuesFromJson(this.createJsonObject(rows))
  }

  setTriggerSetting(
    tableName: string,
    value: 0 | 1,
    namespace: string = this.defaultNamespace
  ): string {
    return `INSERT OR IGNORE INTO _electric_trigger_settings (namespace, tablename, flag) VALUES ('${namespace}', '${tableName}', ${value});`
  }

  createOplogTrigger(
    opType: 'INSERT' | 'UPDATE' | 'DELETE',
    tableName: string,
    newPKs: string,
    newRows: string,
    oldRows: string,
    namespace: string = this.defaultNamespace
  ): string[] {
    const opTypeLower = opType.toLowerCase()
    const pk = this.createPKJsonObject(newPKs)
    // Update has both the old and the new row
    // Delete only has the old row
    const newRecord =
      opType === 'DELETE' ? 'NULL' : this.createJsonObject(newRows)
    // Insert only has the new row
    const oldRecord =
      opType === 'INSERT' ? 'NULL' : this.createJsonObject(oldRows)

    console.log(`oplog:: namespace: ${namespace}, tableName: ${tableName}`)

    return [
      dedent`
        CREATE TRIGGER ${opTypeLower}_${namespace}_${tableName}_into_oplog
           AFTER ${opType} ON "${namespace}"."${tableName}"
           WHEN 1 = (SELECT flag from _electric_trigger_settings WHERE namespace = '${namespace}' AND tablename = '${tableName}')
        BEGIN
          INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
          VALUES ('${namespace}', '${tableName}', '${opType}', ${pk}, ${newRecord}, ${oldRecord}, NULL);
        END;
      `,
    ]
  }

  createFkCompensationTrigger(
    opType: 'INSERT' | 'UPDATE',
    tableName: string,
    childKey: string,
    fkTableName: string,
    joinedFkPKs: string,
    foreignKey: ForeignKey,
    namespace: string = this.defaultNamespace,
    fkTableNamespace: string = this.defaultNamespace
  ): string[] {
    const opTypeLower = opType.toLowerCase()

    console.log(`compensation:: namespace: ${namespace}, fkTableNamespace: ${fkTableNamespace}, tableName: ${tableName}, fkTableName: ${fkTableName}`)

    return [
      dedent`
        CREATE TRIGGER compensation_${opTypeLower}_${namespace}_${tableName}_${childKey}_into_oplog
          AFTER ${opType} ON "${namespace}"."${tableName}"
          WHEN 1 = (SELECT flag from _electric_trigger_settings WHERE namespace = '${fkTableNamespace}' AND tablename = '${fkTableName}') AND
               1 = (SELECT value from _electric_meta WHERE key = 'compensations')
        BEGIN
          INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
          SELECT '${fkTableNamespace}', '${fkTableName}', 'COMPENSATION', ${this.createPKJsonObject(
        joinedFkPKs
      )}, json_object(${joinedFkPKs}), NULL, NULL
          FROM "${fkTableNamespace}"."${fkTableName}" WHERE "${
        foreignKey.parentKey
      }" = new."${foreignKey.childKey}";
        END;
      `,
    ]
  }

  setTagsForShadowRows(
    oplogTable: QualifiedTablename,
    shadowTable: QualifiedTablename
  ): string {
    const oplog = `"${oplogTable.namespace}"."${oplogTable.tablename}"`
    const shadow = `"${shadowTable.namespace}"."${shadowTable.tablename}"`
    return dedent`
      INSERT OR REPLACE INTO ${shadow} (namespace, tablename, primaryKey, tags)
      SELECT namespace, tablename, primaryKey, ?
        FROM ${oplog} AS op
        WHERE timestamp = ?
        GROUP BY namespace, tablename, primaryKey
        HAVING rowid = max(rowid) AND optype != 'DELETE'
    `
  }

  removeDeletedShadowRows(
    oplogTable: QualifiedTablename,
    shadowTable: QualifiedTablename
  ): string {
    const oplog = `"${oplogTable.namespace}"."${oplogTable.tablename}"`
    const shadow = `"${shadowTable.namespace}"."${shadowTable.tablename}"`
    // We do an inner join in a CTE instead of a `WHERE EXISTS (...)`
    // since this is not reliant on re-executing a query
    // for every row in the shadow table, but uses a PK join instead.
    return dedent`
      WITH _to_be_deleted (rowid) AS (
        SELECT shadow.rowid
          FROM ${oplog} AS op
          INNER JOIN ${shadow} AS shadow
            ON shadow.namespace = op.namespace AND shadow.tablename = op.tablename AND shadow.primaryKey = op.primaryKey
          WHERE op.timestamp = ?
          GROUP BY op.namespace, op.tablename, op.primaryKey
          HAVING op.rowid = max(op.rowid) AND op.optype = 'DELETE'
      )
  
      DELETE FROM ${shadow}
      WHERE rowid IN _to_be_deleted
    `
  }

  makePositionalParam(_i: number): string {
    return this.paramSign
  }
}

export default new SqliteBuilder()
