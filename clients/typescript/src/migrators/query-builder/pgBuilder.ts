import { dedent } from 'ts-dedent'
import { QualifiedTablename, SqlValue, Statement } from '../../util'
import { QueryBuilder } from './builder'
import { ForeignKey } from '../triggers'

const quote = (col: string) => `"${col}"`

class PgBuilder extends QueryBuilder {
  readonly dialect = 'Postgres'
  readonly AUTOINCREMENT_PK = 'SERIAL PRIMARY KEY'
  readonly BLOB = 'TEXT'
  readonly deferForeignKeys = 'SET CONSTRAINTS ALL DEFERRED;'
  readonly getVersion = 'SELECT version();'
  readonly paramSign = '$'

  pgOnly(query: string) {
    return query
  }

  pgOnlyQuery(query: string) {
    return [query]
  }

  sqliteOnly(_query: string) {
    return ''
  }

  sqliteOnlyQuery(_query: string) {
    return []
  }

  countTablesIn(countName: string, tables: string[]): Statement {
    const sql = dedent`
      SELECT COUNT(table_name)::integer AS "${countName}"
        FROM information_schema.tables
          WHERE
            table_type = 'BASE TABLE' AND
            table_name IN (${tables.map((_, i) => `$${i + 1}`).join(', ')});
    `
    return {
      sql,
      args: tables,
    }
  }

  createIndex(
    indexName: string,
    onTable: QualifiedTablename,
    columns: string[]
  ) {
    const namespace = onTable.namespace
    const tablename = onTable.tablename
    return `CREATE INDEX IF NOT EXISTS ${indexName} ON "${namespace}"."${tablename}" (${columns
      .map(quote)
      .join(', ')})`
  }

  getLocalTableNames(notIn: string[] = []): Statement {
    let tables = dedent`
      SELECT table_name AS name
        FROM information_schema.tables
        WHERE
          table_type = 'BASE TABLE' AND
          table_schema <> 'pg_catalog' AND
          table_schema <> 'information_schema'
    `
    if (notIn.length > 0) {
      tables += ` AND table_name NOT IN (${notIn
        .map((_, i) => `$${i + 1}`)
        .join(', ')})`
    }
    return {
      sql: tables,
      args: notIn,
    }
  }

  getTableInfo(tablename: string): Statement {
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
          EXISTS (
            SELECT pg_class.relname, pg_attribute.attname
            FROM pg_class, pg_attribute, pg_index
            WHERE pg_class.oid = pg_attribute.attrelid AND
                pg_class.oid = pg_index.indrelid AND
                pg_attribute.attnum = ANY(pg_index.indkey) AND
                pg_index.indisprimary = 't' AND
                pg_class.relname = $1 AND
                pg_attribute.attname = c.column_name
          ) :: INTEGER AS pk
        FROM information_schema.columns AS c
        WHERE
          c.table_name = $1;
      `,
      args: [tablename],
    }
  }

  insertOrIgnore(
    schema: string,
    table: string,
    columns: string[],
    values: SqlValue[]
  ): Statement {
    return {
      sql: dedent`
        INSERT INTO "${schema}"."${table}" (${columns.map(quote).join(', ')})
          VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
          ON CONFLICT DO NOTHING;
      `,
      args: values,
    }
  }

  insertOrReplace(
    schema: string,
    table: string,
    columns: string[],
    values: Array<SqlValue>,
    conflictCols: string[],
    updateCols: string[]
  ): Statement {
    return {
      sql: dedent`
        INSERT INTO "${schema}"."${table}" (${columns.map(quote).join(', ')})
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
    schema: string,
    table: string,
    columns: string[],
    values: Array<SqlValue>,
    conflictCols: string[],
    updateCols: string[],
    updateVals: SqlValue[]
  ): Statement {
    return {
      sql: dedent`
        INSERT INTO "${schema}"."${table}" (${columns.map(quote).join(', ')})
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
    schema: string,
    table: string,
    columns: string[],
    records: Array<Record<string, SqlValue>>,
    conflictCols: string[],
    updateCols: string[],
    maxSqlParameters: number
  ): Statement[] {
    const baseSql = `INSERT INTO "${schema}"."${table}" (${columns
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

  dropTriggerIfExists(
    triggerName: string,
    namespace: string,
    tablename: string
  ) {
    return `DROP TRIGGER IF EXISTS ${triggerName} ON "${namespace}"."${tablename}";`
  }

  createNoFkUpdateTrigger(
    namespace: string,
    tablename: string,
    pk: string[]
  ): string[] {
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
        BEFORE UPDATE ON "${namespace}"."${tablename}"
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

  setTriggerSetting(
    namespace: string,
    tableName: string,
    value: 0 | 1
  ): string {
    return dedent`
      INSERT INTO "main"."_electric_trigger_settings" ("namespace", "tablename", "flag")
        VALUES ('${namespace}', '${tableName}', ${value})
        ON CONFLICT DO NOTHING;
    `
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
        CREATE OR REPLACE FUNCTION ${opTypeLower}_${namespace}_${tableName}_into_oplog_function()
        RETURNS TRIGGER AS $$
        BEGIN
          DECLARE
            flag_value INTEGER;
          BEGIN
            -- Get the flag value from _electric_trigger_settings
            SELECT flag INTO flag_value FROM main._electric_trigger_settings WHERE namespace = '${namespace}' AND tablename = '${tableName}';
    
            IF flag_value = 1 THEN
              -- Insert into _electric_oplog
              INSERT INTO main._electric_oplog (namespace, tablename, optype, "primaryKey", "newRow", "oldRow", timestamp)
              VALUES (
                '${namespace}',
                '${tableName}',
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
        CREATE TRIGGER ${opTypeLower}_${namespace}_${tableName}_into_oplog
          AFTER ${opType} ON "${namespace}"."${tableName}"
            FOR EACH ROW
              EXECUTE FUNCTION ${opTypeLower}_${namespace}_${tableName}_into_oplog_function();
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
        CREATE OR REPLACE FUNCTION compensation_${opTypeLower}_${namespace}_${tableName}_${childKey}_into_oplog_function()
        RETURNS TRIGGER AS $$
        BEGIN
          DECLARE
            flag_value INTEGER;
            meta_value INTEGER;
          BEGIN
            SELECT flag INTO flag_value FROM main._electric_trigger_settings WHERE namespace = '${fkTableNamespace}' AND tablename = '${fkTableName}';
    
            SELECT value INTO meta_value FROM main._electric_meta WHERE key = 'compensations';
    
            IF flag_value = 1 AND meta_value = 1 THEN
              INSERT INTO main._electric_oplog (namespace, tablename, optype, "primaryKey", "newRow", "oldRow", timestamp)
              SELECT
                '${fkTableNamespace}',
                '${fkTableName}',
                'UPDATE',
                ${this.removeSpaceAndNullValuesFromJson(
                  this.createPKJsonObject(joinedFkPKs)
                )},
                jsonb_build_object(${joinedFkPKs}),
                NULL,
                NULL
              FROM "${fkTableNamespace}"."${fkTableName}"
              WHERE "${foreignKey.parentKey}" = NEW."${foreignKey.childKey}";
            END IF;
    
            RETURN NEW;
          END;
        END;
        $$ LANGUAGE plpgsql;
        `,
      dedent`
          CREATE TRIGGER compensation_${opTypeLower}_${namespace}_${tableName}_${childKey}_into_oplog
            AFTER ${opType} ON "${namespace}"."${tableName}"
              FOR EACH ROW
                EXECUTE FUNCTION compensation_${opTypeLower}_${namespace}_${tableName}_${childKey}_into_oplog_function();
        `,
    ]
  }

  setClearTagsForTimestamp(
    oplogTable: QualifiedTablename,
    shadowTable: QualifiedTablename
  ): string {
    const oplog = `"${oplogTable.namespace}"."${oplogTable.tablename}"`
    const shadow = `"${shadowTable.namespace}"."${shadowTable.tablename}"`
    return dedent`
      UPDATE ${oplog}
        SET "clearTags" = ${shadow}.tags
        FROM ${shadow}
        WHERE ${oplog}.namespace = ${shadow}.namespace
          AND ${oplog}.tablename = ${shadow}.tablename
          AND ${shadow}."primaryKey"::jsonb @> ${oplog}."primaryKey"::jsonb AND ${shadow}."primaryKey"::jsonb <@ ${oplog}."primaryKey"::jsonb
          AND ${oplog}.timestamp = $1
    `
  }

  setTagsForShadowRows(
    oplogTable: QualifiedTablename,
    shadowTable: QualifiedTablename
  ): string {
    const oplog = `"${oplogTable.namespace}"."${oplogTable.tablename}"`
    const shadow = `"${shadowTable.namespace}"."${shadowTable.tablename}"`
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
        SELECT ${shadow}.rowid
        FROM ${oplog}
        INNER JOIN ${shadow}
        ON ${shadow}.namespace = ${oplog}.namespace
        AND ${shadow}.tablename = ${oplog}.tablename
        AND
        ${shadow}."primaryKey"::jsonb @> ${oplog}."primaryKey"::jsonb AND ${shadow}."primaryKey"::jsonb <@ ${oplog}."primaryKey"::jsonb
        WHERE ${oplog}.timestamp = $1
        AND ${oplog}.optype = 'DELETE'
        GROUP BY ${shadow}.rowid
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
