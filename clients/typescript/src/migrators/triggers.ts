import { Statement } from '../util'

type ForeignKey = {
  table: string
  childKey: string
  parentKey: string
}

type Table = {
  tableName: string
  namespace: string
  columns: string[]
  primary: string[]
  foreignKeys: ForeignKey[]
}

type TableFullName = string
type Tables = Map<TableFullName, Table>

function mkStatement(sql: string): Statement {
  return { sql }
}

/**
 * Generates the triggers Satellite needs for the given table.
 * Assumes that the necessary meta tables already exist.
 * @param tableFullName - Full name of the table for which to generate triggers.
 * @param table - A new or existing table for which to create/update the triggers.
 * @returns An array of SQLite statements that add the necessary oplog triggers.
 *
 * @remarks
 * We return an array of SQL statements because the DB drivers
 * do not accept queries containing more than one SQL statement.
 */
export function generateOplogTriggers(
  tableFullName: TableFullName,
  table: Omit<Table, 'foreignKeys'>
): Statement[] {
  const { tableName, namespace, columns, primary } = table

  const newPKs = joinColsForJSON(primary, 'new')
  const oldPKs = joinColsForJSON(primary, 'old')
  const newRows = joinColsForJSON(columns, 'new')
  const oldRows = joinColsForJSON(columns, 'old')

  return [
    `
    -- Toggles for turning the triggers on and off
    INSERT OR IGNORE INTO _electric_trigger_settings(tablename,flag) VALUES ('${tableFullName}', 1);
    `,
    `
    /* Triggers for table ${tableName} */
  
    -- ensures primary key is immutable
    DROP TRIGGER IF EXISTS update_ensure_${namespace}_${tableName}_primarykey;
    `,
    `
    CREATE TRIGGER update_ensure_${namespace}_${tableName}_primarykey
      BEFORE UPDATE ON ${tableFullName}
    BEGIN
      SELECT
        CASE
          ${primary
            .map(
              (col) =>
                `WHEN old.${col} != new.${col} THEN\n\t\tRAISE (ABORT, 'cannot change the value of column ${col} as it belongs to the primary key')`
            )
            .join('\n')}
        END;
    END;
    `,
    `
    -- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table
    DROP TRIGGER IF EXISTS insert_${namespace}_${tableName}_into_oplog;
    `,
    `
    CREATE TRIGGER insert_${namespace}_${tableName}_into_oplog
       AFTER INSERT ON ${tableFullName}
       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == '${tableFullName}')
    BEGIN
      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
      VALUES ('${namespace}', '${tableName}', 'INSERT', json_object(${newPKs}), json_object(${newRows}), NULL, NULL);
    END;
    `,
    `
    DROP TRIGGER IF EXISTS update_${namespace}_${tableName}_into_oplog;
    `,
    `
    CREATE TRIGGER update_${namespace}_${tableName}_into_oplog
       AFTER UPDATE ON ${tableFullName}
       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == '${tableFullName}')
    BEGIN
      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
      VALUES ('${namespace}', '${tableName}', 'UPDATE', json_object(${newPKs}), json_object(${newRows}), json_object(${oldRows}), NULL);
    END;
    `,
    `
    DROP TRIGGER IF EXISTS delete_${namespace}_${tableName}_into_oplog;
    `,
    `
    CREATE TRIGGER delete_${namespace}_${tableName}_into_oplog
       AFTER DELETE ON ${tableFullName}
       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == '${tableFullName}')
    BEGIN
      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
      VALUES ('${namespace}', '${tableName}', 'DELETE', json_object(${oldPKs}), NULL, json_object(${oldRows}), NULL);
    END;
    `,
  ].map(mkStatement)
}

/**
 * Generates triggers for compensations for all foreign keys in the provided table.
 * @param tableFullName Full name of the table.
 * @param table The corresponding table.
 * @param tables Map of all tables (needed to look up the tables that are pointed at by FKs).
 * @returns An array of SQLite statements that add the necessary compensation triggers.
 */
function generateCompensationTriggers(
  tableFullName: TableFullName,
  table: Table
): Statement[] {
  const { tableName, namespace, foreignKeys } = table

  const makeTriggers = (foreignKey: ForeignKey) => {
    const { childKey } = foreignKey

    const fkTableNamespace = 'main' // currently, Electric always uses the 'main' namespace
    const fkTableName = foreignKey.table
    // Current assumption is that tables have exactly one PK
    // and that FKs always point to that PK.
    // cf. "Known limitations" document on Slab.
    const fkTablePK = foreignKey.parentKey // primary key of the table pointed at by the FK.
    const joinedFkPKs = joinColsForJSON([fkTablePK])
    const joinedFkCols = joinColsForJSON([fkTablePK]) // Column pointed at by FK is the PK

    return [
      `-- Triggers for foreign key compensations`,
      `DROP TRIGGER IF EXISTS compensation_insert_${namespace}_${tableName}_${childKey}_into_oplog;`,
      // The compensation trigger inserts a row in `_electric_oplog` if the row pointed at by the FK exists
      // The way how this works is that the values for the row are passed to the nested SELECT
      // which will return those values for every record that matches the query
      // which can be at most once since we filter on the foreign key which is also the primary key and thus is unique.
      `
      CREATE TRIGGER compensation_insert_${namespace}_${tableName}_${childKey}_into_oplog
        AFTER INSERT ON ${tableFullName}
        WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == '${fkTableNamespace}.${fkTableName}') AND
             1 == (SELECT value from _electric_meta WHERE key == 'compensations')
      BEGIN
        INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
        SELECT '${fkTableNamespace}', '${fkTableName}', 'UPDATE', json_object(${joinedFkPKs}), json_object(${joinedFkCols}), NULL, NULL
        FROM ${fkTableNamespace}.${fkTableName} WHERE ${foreignKey.parentKey} = new.${foreignKey.childKey};
      END;
      `,
      `DROP TRIGGER IF EXISTS compensation_update_${namespace}_${tableName}_${foreignKey.childKey}_into_oplog;`,
      `
      CREATE TRIGGER compensation_update_${namespace}_${tableName}_${foreignKey.childKey}_into_oplog
         AFTER UPDATE ON ${namespace}.${tableName}
         WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == '${fkTableNamespace}.${fkTableName}') AND
              1 == (SELECT value from _electric_meta WHERE key == 'compensations')
      BEGIN
        INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
        SELECT '${fkTableNamespace}', '${fkTableName}', 'UPDATE', json_object(${joinedFkPKs}), json_object(${joinedFkCols}), NULL, NULL
        FROM ${fkTableNamespace}.${fkTableName} WHERE ${foreignKey.parentKey} = new.${foreignKey.childKey};
      END;
      `,
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
  tableFullName: TableFullName,
  table: Table
): Statement[] {
  const oplogTriggers = generateOplogTriggers(tableFullName, table)
  const fkTriggers = generateCompensationTriggers(tableFullName, table) //, tables)
  return oplogTriggers.concat(fkTriggers)
}

/**
 * Generates triggers for all the provided tables.
 * @param tables - Dictionary mapping full table names to the corresponding tables.
 * @returns An array of SQLite statements that add the necessary oplog and compensation triggers for all tables.
 */
export function generateTriggers(tables: Tables): Statement[] {
  const tableTriggers: Statement[] = []
  tables.forEach((table, tableFullName) => {
    const triggers = generateTableTriggers(tableFullName, table) //, tables)
    tableTriggers.push(...triggers)
  })

  const stmts = [
    { sql: 'DROP TABLE IF EXISTS _electric_trigger_settings;' },
    {
      sql: 'CREATE TABLE _electric_trigger_settings(tablename TEXT PRIMARY KEY, flag INTEGER);',
    },
    ...tableTriggers,
  ]

  return stmts
}

function joinColsForJSON(cols: string[], target?: 'new' | 'old') {
  if (typeof target === 'undefined') {
    return cols
      .sort()
      .map((col) => `'${col}', ${col}`)
      .join(', ')
  } else {
    return cols
      .sort()
      .map((col) => `'${col}', ${target}.${col}`)
      .join(', ')
  }
}
