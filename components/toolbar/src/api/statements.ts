import { DatabaseAdapter } from 'electric-sql/electric'
import { DbTableInfo, TableColumn } from './interface'

export type SqlDialect = 'sqlite' | 'postgres'

const SQLITE_GET_TABLES = `
SELECT name, sql FROM sqlite_master
WHERE type='table'
AND name NOT LIKE 'sqlite_%'
`

const SQLITE_GET_DB_TABLES = `
${SQLITE_GET_TABLES}
AND name NOT LIKE '_electric_%'
`

const SQLITE_GET_ELECTRIC_TABLES = `
${SQLITE_GET_TABLES}
AND name LIKE '_electric_%'
`

const PG_GET_TABLES = `
SELECT table_name AS name FROM information_schema.tables
WHERE table_schema='public'
AND table_name NOT LIKE 'pg_%'
`
const PG_GET_DB_TABLES = `
${PG_GET_TABLES}
AND table_name NOT LIKE '_electric_%'
`

const PG_GET_ELECTRIC_TABLES = `
${PG_GET_TABLES}
AND table_name LIKE '_electric_%'
`

export const getSqlDialect = async (
  adapter: DatabaseAdapter,
): Promise<SqlDialect> => {
  try {
    await adapter.query({
      sql: `SELECT 1 FROM sqlite_master;`,
    })
    return 'sqlite'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (
      err &&
      !err.message.includes('relation "sqlite_master" does not exist')
    ) {
      throw err
    }
  }
  try {
    await adapter.query({
      sql: `SELECT 1 FROM information_schema.tables;`,
    })
    return 'postgres'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (!err.message.includes('no such table: information_schema.tables')) {
      throw err
    }
  }

  throw new Error('Could not determine database dialect type.')
}

export const getDbTables = async (
  adapter: DatabaseAdapter,
  dialect: SqlDialect,
) => {
  const tables = (await adapter.query({
    sql: dialect === 'sqlite' ? SQLITE_GET_DB_TABLES : PG_GET_DB_TABLES,
  })) as unknown as Omit<DbTableInfo, 'columns'>[]

  return Promise.all(
    tables.map(async (tbl) => ({
      ...tbl,
      sql: tbl.sql || '',
      columns: await getTableColumns(adapter, dialect, tbl.name),
    })),
  )
}

export const getElectricTables = async (
  adapter: DatabaseAdapter,
  dialect: SqlDialect,
) => {
  const tables = (await adapter.query({
    sql:
      dialect === 'sqlite'
        ? SQLITE_GET_ELECTRIC_TABLES
        : PG_GET_ELECTRIC_TABLES,
  })) as unknown as Omit<DbTableInfo, 'columns'>[]

  return Promise.all(
    tables.map(async (tbl) => ({
      ...tbl,
      sql: tbl.sql || '',
      columns: await getTableColumns(adapter, dialect, tbl.name),
    })),
  )
}

const getTableColumns = async (
  adapter: DatabaseAdapter,
  dialect: SqlDialect,
  tableName: string,
): Promise<TableColumn[]> => {
  const columns = await adapter.query({
    sql:
      dialect === 'sqlite'
        ? `
    PRAGMA table_info(${tableName})`
        : `
    SELECT
      column_name as name,
      data_type as type,
      (is_nullable = 'NO') as notnull
    FROM information_schema.columns
    WHERE table_name = '${tableName}';`,
  })
  return columns.map((c) => ({
    name: c.name,
    type: c.type,
    nullable: !c.notnull,
  })) as TableColumn[]
}
