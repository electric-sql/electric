import { dedent } from 'ts-dedent'
import { QualifiedTablename } from '../../util'
import { QueryBuilder } from './builder'
import { ForeignKey } from '../triggers'

const quote = (col: string) => `"${col}"`

class PgBuilder extends QueryBuilder {
  readonly AUTOINCREMENT_PK = 'SERIAL PRIMARY KEY'
  readonly BLOB = 'TEXT'

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

  insertOrIgnore(
    schema: string,
    table: string,
    columns: string[],
    values: string[]
  ) {
    return dedent`
      INSERT INTO "${schema}"."${table}" (${columns.map(quote).join(', ')})
      VALUES (${values.join(', ')})
      ON CONFLICT DO NOTHING;
    `
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

  createJsonObject(rows: string) {
    return `jsonb_build_object(${rows})`
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
                jsonb_build_object(${joinedFkPKs}),
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
}

export default new PgBuilder()
