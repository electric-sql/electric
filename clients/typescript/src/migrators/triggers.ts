import { Statement } from '../util'

type ForeignKey = {
  table: string
  childKey: string
  parentKey: string
}

/*
type Table = {
  tableFullName: string,
  table: {
    tableName: string
    namespace: string
    columns: string[]
    primary: string[]
    foreignKeys: ForeignKey[]
  }
}
*/

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
       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == ' ${tableFullName}')
    BEGIN
      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
      VALUES ('${namespace}', '${tableName}', 'DELETE', json_object(${oldPKs}), NULL, json_object(${oldRows}), NULL);
    END;
    `,
  ].map(mkStatement)

  //return `
  //-- Toggles for turning the triggers on and off
  //INSERT OR IGNORE INTO _electric_trigger_settings(tablename,flag) VALUES ('${tableFullName}', 1);
  //
  ///* Triggers for table ${tableName} */
  //
  //-- ensures primary key is immutable
  //DROP TRIGGER IF EXISTS update_ensure_${namespace}_${tableName}_primarykey;
  //CREATE TRIGGER update_ensure_${namespace}_${tableName}_primarykey
  //  BEFORE UPDATE ON ${tableFullName}
  //BEGIN
  //  SELECT
  //    CASE
  //      ${primary.map(col => `WHEN old.${col} != new.${col} THEN\n\t\tRAISE (ABORT, 'cannot change the value of column ${col} as it belongs to the primary key')`).join('\n')}
  //    END;
  //END;
  //
  //-- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table
  //DROP TRIGGER IF EXISTS insert_${namespace}_${tableName}_into_oplog;
  //CREATE TRIGGER insert_${namespace}_${tableName}_into_oplog
  //   AFTER INSERT ON ${tableFullName}
  //   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == '${tableFullName}')
  //BEGIN
  //  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  //  VALUES ('${namespace}', '${tableName}', 'INSERT', json_object(${newPKs}), json_object(${newRows}), NULL, NULL);
  //END;
  //
  //DROP TRIGGER IF EXISTS update_${namespace}_${tableName}_into_oplog;
  //CREATE TRIGGER update_${namespace}_${tableName}_into_oplog
  //   AFTER UPDATE ON ${tableFullName}
  //   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == '${tableFullName}')
  //BEGIN
  //  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  //  VALUES ('${namespace}', '${tableName}', 'UPDATE', json_object(${newPKs}), json_object(${newRows}), json_object(${oldRows}), NULL);
  //END;
  //
  //DROP TRIGGER IF EXISTS delete_${namespace}_${tableName}_into_oplog;
  //CREATE TRIGGER delete_${namespace}_${tableName}_into_oplog
  //   AFTER DELETE ON ${tableFullName}
  //   WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == ' ${tableFullName}')
  //BEGIN
  //  INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
  //  VALUES ('${namespace}', '${tableName}', 'DELETE', json_object(${oldPKs}), NULL, json_object(${oldRows}), NULL);
  //END;
  //`
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
  table: Table,
  tables: Tables
): Statement[] {
  const { tableName, namespace, foreignKeys } = table

  const makeTriggers = (foreignKey: ForeignKey) => {
    const { childKey } = foreignKey
    const fkTable = tables.get(foreignKey.table)
    if (fkTable === undefined)
      throw new Error(`Table ${foreignKey.table} for foreign key not found.`)
    const joinedFkPKs = joinColsForJSON(fkTable.primary)
    const joinedFkCols = joinColsForJSON(fkTable.columns)
    return [
      `DROP TRIGGER IF EXISTS compensation_insert_${namespace}_${tableName}_${childKey}_into_oplog;`,
      `
      CREATE TRIGGER compensation_insert_${namespace}_${tableName}_${childKey}_into_oplog
        AFTER INSERT ON ${tableFullName}
        WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == '${fkTable.namespace}.${fkTable.tableName}') AND
             1 == (SELECT value from _electric_meta WHERE key == 'compensations')
      BEGIN
        INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
        SELECT '${fkTable.namespace}', '${fkTable.tableName}', 'UPDATE', json_object(${joinedFkPKs}), json_object(${joinedFkCols}), NULL, NULL
        FROM ${fkTable.namespace}.${fkTable.tableName} WHERE ${foreignKey.parentKey} = new.${foreignKey.childKey};
      END;
      `,
      `DROP TRIGGER IF EXISTS compensation_update_${namespace}_${tableName}_${foreignKey.childKey}_into_oplog;`,
      `
      CREATE TRIGGER compensation_update_${namespace}_${tableName}_${foreignKey.childKey}_into_oplog
         AFTER UPDATE ON ${namespace}.${tableName}
         WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == '${fkTable.namespace}.${fkTable.tableName}') AND
              1 == (SELECT value from _electric_meta WHERE key == 'compensations')
      BEGIN
        INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
        SELECT '${fkTable.namespace}', '${fkTable.tableName}', 'UPDATE', json_object(${joinedFkPKs}), json_object(${joinedFkCols}), NULL, NULL
        FROM ${fkTable.namespace}.${fkTable.tableName} WHERE ${foreignKey.parentKey} = new.${foreignKey.childKey};
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
  tables: Tables
): Statement[] {
  const table = tables.get(tableFullName)
  if (typeof table === 'undefined')
    throw new Error(
      `Could not generate triggers for ${tableFullName}. Table not found.`
    )
  const oplogTriggers = generateOplogTriggers(tableFullName, table)
  const fkTriggers = generateCompensationTriggers(tableFullName, table, tables)
  return oplogTriggers.concat(fkTriggers)
}

/**
 * Generates triggers for all the provided tables.
 * @param tables - Dictionary mapping full table names to the corresponding tables.
 * @param isInit - Flag to indicate if the meta tables need to be created and initialized.
 * @returns An array of SQLite statements that add the necessary oplog and compensation triggers for all tables.
 */
export function generateTriggers(tables: Tables, isInit: boolean): Statement[] {
  const tableTriggers: Statement[] = []
  tables.forEach((_table, tableFullName) => {
    const triggers = generateTableTriggers(tableFullName, tables)
    tableTriggers.push(...triggers)
  })

  const stmts = isInit ? createMetaTables : []
  stmts.push(
    { sql: 'DROP TABLE IF EXISTS _electric_trigger_settings;' },
    {
      sql: 'CREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);',
    },
    ...tableTriggers
  )

  return stmts
}

function joinColsForJSON(cols: string[], target?: 'new' | 'old') {
  if (typeof target === 'undefined') {
    return cols.map((col) => `'${col}', ${col}`).join(', ')
  } else {
    return cols.map((col) => `'${col}', ${target}.${col}`).join(', ')
  }
}

const createMetaTables: Statement[] = [
  `
  -- The ops log table
  CREATE TABLE IF NOT EXISTS _electric_oplog (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace String NOT NULL,
    tablename String NOT NULL,
    optype String NOT NULL,
    primaryKey String NOT NULL,
    newRow String,
    oldRow String,
    timestamp TEXT
  );
  `,
  `
  -- Somewhere to keep our metadata
  CREATE TABLE IF NOT EXISTS _electric_meta (
    key TEXT PRIMARY KEY,
    value BLOB
  );
  `,
  `
  -- Somewhere to track migrations
  CREATE TABLE IF NOT EXISTS _electric_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
  `,
  `
  -- Initialisation of the metadata table
  INSERT INTO _electric_meta (key, value) VALUES ('compensations', 0), ('lastAckdRowId','0'), ('lastSentRowId', '0'), ('lsn', 'MA=='), ('clientId', '');
  `,
].map(mkStatement)
