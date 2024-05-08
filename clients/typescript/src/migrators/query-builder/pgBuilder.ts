import { dedent } from 'ts-dedent'
import { QualifiedTablename, SqlValue, Statement } from '../../util'
import { QueryBuilder } from './builder'
import { ForeignKey } from '../triggers'

const quote = (col: string) => `"${col}"`

class PgBuilder extends QueryBuilder {
  readonly dialect = 'Postgres'
  readonly AUTOINCREMENT_PK = 'SERIAL PRIMARY KEY'
  readonly BLOB = 'TEXT'
  readonly getVersion = 'SELECT version();'
  readonly paramSign = '$'
  readonly defaultNamespace = 'public'

  /** **Disables** FKs for the duration of the transaction */
  readonly deferOrDisableFKsForTx =
    'SET LOCAL session_replication_role = replica;'

  pgOnly(query: string) {
    return query
  }

  sqliteOnly(_query: string) {
    return ''
  }

  tableExists(table: QualifiedTablename): Statement {
    return {
      sql: `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      args: [table.namespace, table.tablename],
    }
  }

  countTablesIn(tableNames: string[]): Statement {
    const sql = dedent`
      SELECT COUNT(table_name)::integer AS "count"
        FROM information_schema.tables
          WHERE
            table_type = 'BASE TABLE' AND
            table_name IN (${tableNames.map((_, i) => `$${i + 1}`).join(', ')});
    `
    return {
      sql,
      args: tableNames,
    }
  }

  toHex(column: string): string {
    return `encode(${column}::bytea, 'hex')`
  }

  hexValue(hexString: string): string {
    return `'\\x${hexString}'`
  }

  createIndex(
    indexName: string,
    onTable: QualifiedTablename,
    columns: string[]
  ) {
    return `CREATE INDEX IF NOT EXISTS ${indexName} ON ${onTable} (${columns
      .map(quote)
      .join(', ')})`
  }

  getLocalTableNames(notIn: string[] = []): Statement {
    let tables = dedent`
      SELECT relname AS name
      FROM pg_class
      JOIN pg_namespace ON relnamespace = pg_namespace.oid
      WHERE
        relkind = 'r'
        AND nspname <> 'pg_catalog'
        AND nspname <> 'information_schema'
    `
    if (notIn.length > 0) {
      tables += `\n  AND relname NOT IN (${notIn
        .map((_, i) => `$${i + 1}`)
        .join(', ')})`
    }
    return {
      sql: tables,
      args: notIn,
    }
  }

  getTableInfo(table: QualifiedTablename): Statement {
    return {
      sql: dedent`
        SELECT
          c.column_name AS name,
          UPPER(c.data_type) AS type,
          CASE
            WHEN c.is_nullable = 'YES' THEN 0
            ELSE 1
          END AS notnull,
          c.column_default AS dflt_value,
          COALESCE(
            (
              -- Subquery to determine if the column is part of the primary key and 
              -- its position. We +1 to the position as we return 0 if the column 
              -- is not part of the primary key.
              SELECT array_position(ind.indkey, att.attnum) + 1
              FROM pg_class cl
              JOIN pg_attribute att ON cl.oid = att.attrelid
              JOIN pg_index ind ON cl.oid = ind.indrelid
              JOIN pg_constraint con ON con.conindid = ind.indexrelid
              WHERE cl.relname = c.table_name  -- Match the table name
                AND att.attname = c.column_name  -- Match the column name
                AND cl.relnamespace = (
                  SELECT oid FROM pg_namespace WHERE nspname = c.table_schema
                )  -- Match the schema
                AND con.contype = 'p'  -- Only consider primary key constraints
            ), 
            0  -- If the column is not part of the primary key, return 0
        ) AS pk
        FROM information_schema.columns AS c
        WHERE
          c.table_name = $1 AND
          c.table_schema = $2;
      `,
      args: [table.tablename, table.namespace],
    }
  }

  insertOrIgnore(
    table: QualifiedTablename,
    columns: string[],
    values: SqlValue[]
  ): Statement {
    return {
      sql: dedent`
        INSERT INTO ${table} (${columns.map(quote).join(', ')})
          VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
          ON CONFLICT DO NOTHING;
      `,
      args: values,
    }
  }

  insertOrReplace(
    table: QualifiedTablename,
    columns: string[],
    values: Array<SqlValue>,
    conflictCols: string[],
    updateCols: string[]
  ): Statement {
    return {
      sql: dedent`
        INSERT INTO ${table} (${columns.map(quote).join(', ')})
          VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
        ON CONFLICT (${conflictCols.map(quote).join(', ')}) DO UPDATE
          SET ${updateCols
            .map((col) => `${quote(col)} = EXCLUDED.${quote(col)}`)
            .join(', ')};
      `,
      args: values,
    }
  }

  insertOrReplaceWith(
    table: QualifiedTablename,
    columns: string[],
    values: Array<SqlValue>,
    conflictCols: string[],
    updateCols: string[],
    updateVals: SqlValue[]
  ): Statement {
    return {
      sql: dedent`
        INSERT INTO ${table} (${columns.map(quote).join(', ')})
          VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
        ON CONFLICT (${conflictCols.map(quote).join(', ')}) DO UPDATE
          SET ${updateCols
            .map((col, i) => `${quote(col)} = $${columns.length + i + 1}`)
            .join(', ')};
      `,
      args: values.concat(updateVals),
    }
  }

  batchedInsertOrReplace(
    table: QualifiedTablename,
    columns: string[],
    records: Array<Record<string, SqlValue>>,
    conflictCols: string[],
    updateCols: string[],
    maxSqlParameters: number
  ): Statement[] {
    const baseSql = `INSERT INTO ${table} (${columns
      .map(quote)
      .join(', ')}) VALUES `
    const statements = this.prepareInsertBatchedStatements(
      baseSql,
      columns,
      records,
      maxSqlParameters
    )
    return statements.map(({ sql, args }) => ({
      sql: dedent`
        ${sql}
        ON CONFLICT (${conflictCols.map(quote).join(', ')}) DO UPDATE
        SET ${updateCols
          .map((col) => `${quote(col)} = EXCLUDED.${quote(col)}`)
          .join(', ')};
      `,
      args,
    }))
  }

  dropTriggerIfExists(triggerName: string, table: QualifiedTablename) {
    return `DROP TRIGGER IF EXISTS ${triggerName} ON ${table};`
  }

  createNoFkUpdateTrigger(table: QualifiedTablename, pk: string[]): string[] {
    const { namespace, tablename } = table
    return [
      dedent`
        CREATE OR REPLACE FUNCTION update_ensure_${namespace}_${tablename}_primarykey_function()
        RETURNS TRIGGER AS $$
        BEGIN
          ${pk
            .map(
              (col) =>
                dedent`IF OLD."${col}" IS DISTINCT FROM NEW."${col}" THEN
                  RAISE EXCEPTION 'Cannot change the value of column ${col} as it belongs to the primary key';
                END IF;`
            )
            .join('\n')}
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `,
      dedent`
      CREATE TRIGGER update_ensure_${namespace}_${tablename}_primarykey
        BEFORE UPDATE ON ${table}
          FOR EACH ROW
            EXECUTE FUNCTION update_ensure_${namespace}_${tablename}_primarykey_function();
      `,
    ]
  }

  // This creates a JSON object that is equivalent
  // to the JSON objects created by SQLite
  // in that it does not re-order the keys
  // and removes whitespaces between keys and values.
  createPKJsonObject(rows: string) {
    // `json_build_object` introduces whitespaces
    // e.g. `{"a" : 5, "b" : 6}`
    // But the json produced by SQLite is `{"a":5,"b":6}`.
    // So this may lead to problems because we use this JSON string
    // of the primary key to compare local and remote entries.
    // But the changes for the same PK would be considered to be different PKs
    // if e.g. the local change is PG and the remote change is SQLite.
    // We use `json_strip_nulls` on the PK as it removes the whitespaces.
    // It also removes `null` values from the PK. Therefore, it is important
    // that the SQLite oplog triggers also remove `null` values from the PK.
    return `json_strip_nulls(json_build_object(${rows}))`
  }

  createJsonbObject(rows: string) {
    return `jsonb_build_object(${rows})`
  }

  // removes null values from the json object
  // but most importantly also removes whitespaces introduced by `jsonb_build_object`
  removeSpaceAndNullValuesFromJson(json: string): string {
    return `json_strip_nulls(${json})`
  }

  setTriggerSetting(table: QualifiedTablename, value: 0 | 1): string {
    const { namespace, tablename } = table
    return dedent`
      INSERT INTO "${namespace}"."_electric_trigger_settings" ("namespace", "tablename", "flag")
        VALUES ('${namespace}', '${tablename}', ${value})
        ON CONFLICT DO NOTHING;
    `
  }

  createOplogTrigger(
    opType: 'INSERT' | 'UPDATE' | 'DELETE',
    table: QualifiedTablename,
    newPKs: string,
    newRows: string,
    oldRows: string
  ): string[] {
    const { namespace, tablename } = table
    const opTypeLower = opType.toLowerCase()
    const pk = this.createPKJsonObject(newPKs)
    // Update has both the old and the new row
    // Delete only has the old row
    const newRecord =
      opType === 'DELETE' ? 'NULL' : this.createJsonbObject(newRows)
    // Insert only has the new row
    const oldRecord =
      opType === 'INSERT' ? 'NULL' : this.createJsonbObject(oldRows)

    return [
      dedent`
        CREATE OR REPLACE FUNCTION ${opTypeLower}_${namespace}_${tablename}_into_oplog_function()
        RETURNS TRIGGER AS $$
        BEGIN
          DECLARE
            flag_value INTEGER;
          BEGIN
            -- Get the flag value from _electric_trigger_settings
            SELECT flag INTO flag_value FROM "${namespace}"._electric_trigger_settings WHERE namespace = '${namespace}' AND tablename = '${tablename}';
    
            IF flag_value = 1 THEN
              -- Insert into _electric_oplog
              INSERT INTO "${namespace}"._electric_oplog (namespace, tablename, optype, "primaryKey", "newRow", "oldRow", timestamp)
              VALUES (
                '${namespace}',
                '${tablename}',
                '${opType}',
                ${pk},
                ${newRecord},
                ${oldRecord},
                NULL
              );
            END IF;
    
            RETURN NEW;
          END;
        END;
        $$ LANGUAGE plpgsql;
      `,
      dedent`
        CREATE TRIGGER ${opTypeLower}_${namespace}_${tablename}_into_oplog
          AFTER ${opType} ON ${table}
            FOR EACH ROW
              EXECUTE FUNCTION ${opTypeLower}_${namespace}_${tablename}_into_oplog_function();
      `,
    ]
  }

  createFkCompensationTrigger(
    opType: 'INSERT' | 'UPDATE',
    table: QualifiedTablename,
    childKey: string,
    fkTable: QualifiedTablename,
    joinedFkPKs: string,
    foreignKey: ForeignKey
  ): string[] {
    const { namespace, tablename } = table
    const { namespace: fkTableNamespace, tablename: fkTableName } = fkTable
    const opTypeLower = opType.toLowerCase()

    return [
      dedent`
        CREATE OR REPLACE FUNCTION compensation_${opTypeLower}_${namespace}_${tablename}_${childKey}_into_oplog_function()
        RETURNS TRIGGER AS $$
        BEGIN
          DECLARE
            flag_value INTEGER;
            meta_value INTEGER;
          BEGIN
            SELECT flag INTO flag_value FROM "${namespace}"._electric_trigger_settings WHERE namespace = '${namespace}' AND tablename = '${tablename}';
    
            SELECT value INTO meta_value FROM "${namespace}"._electric_meta WHERE key = 'compensations';
    
            IF flag_value = 1 AND meta_value = 1 THEN
              INSERT INTO "${namespace}"._electric_oplog (namespace, tablename, optype, "primaryKey", "newRow", "oldRow", timestamp)
              SELECT
                '${fkTableNamespace}',
                '${fkTableName}',
                'COMPENSATION',
                ${this.removeSpaceAndNullValuesFromJson(
                  this.createPKJsonObject(joinedFkPKs)
                )},
                jsonb_build_object(${joinedFkPKs}),
                NULL,
                NULL
              FROM ${fkTable}
              WHERE "${foreignKey.parentKey}" = NEW."${foreignKey.childKey}";
            END IF;
    
            RETURN NEW;
          END;
        END;
        $$ LANGUAGE plpgsql;
        `,
      dedent`
          CREATE TRIGGER compensation_${opTypeLower}_${namespace}_${tablename}_${childKey}_into_oplog
            AFTER ${opType} ON ${table}
              FOR EACH ROW
                EXECUTE FUNCTION compensation_${opTypeLower}_${namespace}_${tablename}_${childKey}_into_oplog_function();
        `,
    ]
  }

  setTagsForShadowRows(
    oplog: QualifiedTablename,
    shadow: QualifiedTablename
  ): string {
    return dedent`
      INSERT INTO ${shadow} (namespace, tablename, "primaryKey", tags)
        SELECT DISTINCT namespace, tablename, "primaryKey", $1
          FROM ${oplog} AS op
          WHERE
            timestamp = $2
            AND optype != 'DELETE'
          ON CONFLICT (namespace, tablename, "primaryKey")
        DO UPDATE SET tags = EXCLUDED.tags;
    `
  }

  removeDeletedShadowRows(
    oplog: QualifiedTablename,
    shadow: QualifiedTablename
  ): string {
    // We do an inner join in a CTE instead of a `WHERE EXISTS (...)`
    // since this is not reliant on re-executing a query
    // for every row in the shadow table, but uses a PK join instead.
    return dedent`
      WITH 
        _relevant_shadows AS (
          SELECT DISTINCT ON (s.rowid)
            s.rowid AS rowid,
            op.optype AS last_optype
          FROM ${oplog} AS op
          INNER JOIN ${shadow} AS s
          ON s.namespace = op.namespace
            AND s.tablename = op.tablename
            AND s."primaryKey"::jsonb = op."primaryKey"::jsonb
          WHERE op.timestamp = $1
          ORDER BY s.rowid, op.rowid DESC
        ),
        _to_be_deleted AS (
          SELECT rowid FROM _relevant_shadows WHERE last_optype = 'DELETE'
        )
      DELETE FROM ${shadow}
      WHERE rowid IN (SELECT rowid FROM _to_be_deleted);
    `
  }

  makePositionalParam(i: number): string {
    return this.paramSign + i
  }
}

export default new PgBuilder()
