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
    INSERT INTO main._electric_trigger_settings (tablename, flag)
    VALUES ('${tableFullName}', 1)
    ON CONFLICT (tablename) DO NOTHING;
    `,
    `
    /* Triggers for table ${tableName} */

    -- ensures primary key is immutable
    DROP TRIGGER IF EXISTS update_ensure_${namespace}_${tableName}_primarykey ON ${namespace}.${tableName};
    `,
    `
    CREATE OR REPLACE FUNCTION update_ensure_${namespace}_${tableName}_primarykey_function()
    RETURNS TRIGGER AS $$
    BEGIN
      ${primary
        .map(
          (col) =>
            `IF OLD.${col} IS DISTINCT FROM NEW.${col} THEN
              RAISE EXCEPTION 'Cannot change the value of column ${col} as it belongs to the primary key';
            END IF;`
        )
        .join('\n')}
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER update_ensure_${namespace}_${tableName}_primarykey
    BEFORE UPDATE ON ${namespace}.${tableName}
    FOR EACH ROW
    EXECUTE FUNCTION update_ensure_${namespace}_${tableName}_primarykey_function();
    `,
    `
    -- Triggers that add INSERT, UPDATE, DELETE operation to the _opslog table
    DROP TRIGGER IF EXISTS insert_${namespace}_${tableName}_into_oplog ON ${namespace}.${tableName};
    `,
    `
    CREATE OR REPLACE FUNCTION insert_${namespace}_${tableName}_into_oplog_function()
    RETURNS TRIGGER AS $$
    BEGIN
      DECLARE
        flag_value INTEGER;
      BEGIN
        SELECT flag INTO flag_value FROM main._electric_trigger_settings WHERE tablename = '${tableFullName}';

        IF flag_value = 1 THEN
          INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
          VALUES (
            '${namespace}',
            '${tableName}',
            'INSERT',
            jsonb_build_object(${newPKs}),
            jsonb_build_object(${newRows}),
            NULL,
            NULL
          );
        END IF;

        RETURN NEW;
      END;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER insert_${namespace}_${tableName}_into_oplog
    AFTER INSERT ON ${namespace}.${tableName}
    FOR EACH ROW
    EXECUTE FUNCTION insert_${namespace}_${tableName}_into_oplog_function();
    `,
    `
    DROP TRIGGER IF EXISTS update_${namespace}_${tableName}_into_oplog ON ${namespace}.${tableName};
    `,
    `
    CREATE OR REPLACE FUNCTION update_${namespace}_${tableName}_into_oplog_function()
    RETURNS TRIGGER AS $$
    BEGIN
      DECLARE
        flag_value INTEGER;
      BEGIN
        -- Get the flag value from _electric_trigger_settings
        SELECT flag INTO flag_value FROM _electric_trigger_settings WHERE tablename = '${tableFullName}';

        IF flag_value = 1 THEN
          -- Insert into _electric_oplog
          INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
          VALUES (
            '${namespace}',
            '${tableName}',
            'UPDATE',
            jsonb_build_object(${newPKs}),
            jsonb_build_object(${newRows}),
            jsonb_build_object(${oldRows}),
            NULL
          );
        END IF;

        RETURN NEW;
      END;
    END;
    $$ LANGUAGE plpgsql;

    -- Create the trigger on the specified table
    CREATE TRIGGER update_${namespace}_${tableName}_into_oplog
    AFTER UPDATE ON ${namespace}.${tableName}
    FOR EACH ROW
    EXECUTE FUNCTION update_${namespace}_${tableName}_into_oplog_function();
    `,
    `
    DROP TRIGGER IF EXISTS delete_${namespace}_${tableName}_into_oplog ON ${namespace}.${tableName};
    `,
    `
    CREATE OR REPLACE FUNCTION delete_${namespace}_${tableName}_into_oplog_function()
    RETURNS TRIGGER AS $$
    BEGIN
      DECLARE
        flag_value INTEGER;
      BEGIN
        SELECT flag INTO flag_value FROM main._electric_trigger_settings WHERE tablename = '${tableFullName}';

        IF flag_value = 1 THEN
          INSERT INTO main._electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
          VALUES (
            '${namespace}',
            '${tableName}',
            'DELETE',
            jsonb_build_object(${oldPKs}),
            NULL,
            jsonb_build_object(${oldRows}),
            NULL
          );
        END IF;

        RETURN OLD;
      END;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER delete_${namespace}_${tableName}_into_oplog
    AFTER DELETE ON ${namespace}.${tableName}
    FOR EACH ROW
    EXECUTE FUNCTION delete_${namespace}_${tableName}_into_oplog_function();
    `,
  ].map(mkStatement)
}

/**
 * Generates triggers for compensations for all foreign keys in the provided table.
 *
 * Compensation is recorded as a specially-formatted update. It acts as a no-op, with
 * previous value set to NULL, and it's on the server to figure out that this is a no-op
 * compensation operation (usually `UPDATE` would have previous row state known). The entire
 * reason for it existing is to maybe revive the row if it has been deleted, so we need correct tags.
 *
 * The compensation update contains _just_ the primary keys, no other columns are present.
 *
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
    const fkTablePK = foreignKey.parentKey // primary key of the table pointed at by the FK.
    const joinedFkPKs = joinColsForJSON([fkTablePK])

    return [
      `-- Triggers for foreign key compensations
      DROP TRIGGER IF EXISTS compensation_insert_${namespace}_${tableName}_${childKey}_into_oplog ON ${namespace}.${tableName};`,
      // The compensation trigger inserts a row in `_electric_oplog` if the row pointed at by the FK exists
      // The way how this works is that the values for the row are passed to the nested SELECT
      // which will return those values for every record that matches the query
      // which can be at most once since we filter on the foreign key which is also the primary key and thus is unique.
      `
      CREATE OR REPLACE FUNCTION compensation_insert_${namespace}_${tableName}_${childKey}_into_oplog_function()
      RETURNS TRIGGER AS $$
      BEGIN
        DECLARE
          flag_value INTEGER;
          meta_value INTEGER;
        BEGIN
          SELECT flag INTO flag_value FROM main._electric_trigger_settings WHERE tablename = '${fkTableNamespace}.${fkTableName}';

          SELECT value INTO meta_value FROM main._electric_meta WHERE key = 'compensations';

          IF flag_value = 1 AND meta_value = 1 THEN
            INSERT INTO main._electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
            SELECT
              '${fkTableNamespace}',
              '${fkTableName}',
              'UPDATE',
              jsonb_build_object(${joinedFkPKs}),
              jsonb_build_object(${joinedFkPKs}),
              NULL,
              NULL
            FROM ${fkTableNamespace}.${fkTableName}
            WHERE ${foreignKey.parentKey} = NEW.${foreignKey.childKey};
          END IF;

          RETURN NEW;
        END;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER compensation_insert_${namespace}_${tableName}_${childKey}_into_oplog
      AFTER INSERT ON ${tableFullName}
      FOR EACH ROW
      EXECUTE FUNCTION compensation_insert_${namespace}_${tableName}_${childKey}_into_oplog_function();
      `,
      `DROP TRIGGER IF EXISTS compensation_update_${namespace}_${tableName}_${foreignKey.childKey}_into_oplog ON ${namespace}.${tableName};`,
      `
      CREATE OR REPLACE FUNCTION compensation_update_${namespace}_${tableName}_${foreignKey.childKey}_into_oplog_function()
      RETURNS TRIGGER AS $$
      BEGIN
        DECLARE
          flag_value INTEGER;
          meta_value INTEGER;
        BEGIN
          SELECT flag INTO flag_value FROM main._electric_trigger_settings WHERE tablename = '${fkTableNamespace}.${fkTableName}';

          SELECT value INTO meta_value FROM main._electric_meta WHERE key = 'compensations';

          IF flag_value = 1 AND meta_value = 1 THEN
            INSERT INTO main._electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
            SELECT
              '${fkTableNamespace}',
              '${fkTableName}',
              'UPDATE',
              jsonb_build_object(${joinedFkPKs}),
              jsonb_build_object(${joinedFkPKs}),
              NULL,
              NULL
            FROM ${fkTableNamespace}.${fkTableName}
            WHERE ${foreignKey.parentKey} = NEW.${foreignKey.childKey};
          END IF;

          RETURN NEW;
        END;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER compensation_update_${namespace}_${tableName}_${foreignKey.childKey}_into_oplog
      AFTER UPDATE ON ${namespace}.${tableName}
      FOR EACH ROW
      EXECUTE FUNCTION compensation_update_${namespace}_${tableName}_${foreignKey.childKey}_into_oplog_function();
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
    { sql: 'DROP TABLE IF EXISTS main._electric_trigger_settings;' },
    {
      sql: 'CREATE TABLE main._electric_trigger_settings(tablename TEXT PRIMARY KEY, flag INTEGER);',
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
