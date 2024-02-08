import { dedent } from 'ts-dedent'
import { QualifiedTablename } from '../../util'
import { QueryBuilder } from './builder'
import { ForeignKey } from '../triggers'

class SqliteBuilder extends QueryBuilder {
  readonly AUTOINCREMENT_PK = 'INTEGER PRIMARY KEY AUTOINCREMENT'
  readonly BLOB = 'BLOB'

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

  insertOrIgnore(
    schema: string,
    table: string,
    columns: string[],
    values: string[]
  ) {
    return dedent`
      INSERT OR IGNORE INTO ${schema}.${table} (${columns.join(', ')})
      VALUES (${values.join(', ')});
    `
  }

  dropTriggerIfExists(
    triggerName: string,
    _namespace: string,
    _tablename: string
  ) {
    return `DROP TRIGGER IF EXISTS ${triggerName};`
  }

  createNoFkUpdateTrigger(
    namespace: string,
    tablename: string,
    pk: string[]
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

  createOplogTrigger(
    opType: 'INSERT' | 'UPDATE' | 'DELETE',
    namespace: string,
    tableName: string,
    newPKs: string,
    newRows: string,
    oldRows: string
  ): string[] {
    const opTypeLower = opType.toLowerCase()
    const pk = this.createJsonObject(newPKs)
    // Update has both the old and the new row
    // Delete only has the old row
    const newRecord =
      opType === 'DELETE' ? 'NULL' : this.createJsonObject(newRows)
    // Insert only has the new row
    const oldRecord =
      opType === 'INSERT' ? 'NULL' : this.createJsonObject(oldRows)

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
    namespace: string,
    tableName: string,
    childKey: string,
    fkTableNamespace: string,
    fkTableName: string,
    joinedFkPKs: string,
    foreignKey: ForeignKey
  ): string[] {
    const opTypeLower = opType.toLowerCase()
    return [
      dedent`
        CREATE TRIGGER compensation_${opTypeLower}_${namespace}_${tableName}_${childKey}_into_oplog
          AFTER ${opType} ON "${namespace}"."${tableName}"
          WHEN 1 = (SELECT flag from _electric_trigger_settings WHERE namespace = '${namespace}' AND tablename = '${fkTableNamespace}.${fkTableName}') AND
               1 = (SELECT value from _electric_meta WHERE key = 'compensations')
        BEGIN
          INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
          SELECT '${fkTableNamespace}', '${fkTableName}', 'COMPENSATION', json_object(${joinedFkPKs}), json_object(${joinedFkPKs}), NULL, NULL
          FROM "${fkTableNamespace}"."${fkTableName}" WHERE "${foreignKey.parentKey}" = new."${foreignKey.childKey}";
        END;
      `,
    ]
  }
}

export default new SqliteBuilder()
