import pg from 'pg'
import SQLiteDatabase from 'better-sqlite3'
import type { Database as BetterSqliteDatabase } from 'electric-sql/node'
import { ElectricConfig } from 'electric-sql'
import { mockSecureAuthToken } from 'electric-sql/auth/secure'
import type { Database as PgDatabase } from 'electric-sql/node-postgres'
import { setLogLevel } from 'electric-sql/debug'
import { electrify as electrifySqlite } from 'electric-sql/node'
import { electrify as electrifyPg } from 'electric-sql/node-postgres'
import { v4 as uuidv4 } from 'uuid'
import {
  schema,
  Electric,
} from './generated/client'
import { globalRegistry, Satellite } from 'electric-sql/satellite'
import { QualifiedTablename, SatelliteErrorCode } from 'electric-sql/util'
import { Shape } from 'electric-sql/satellite'
import {
  pgBuilder,
  sqliteBuilder,
  QueryBuilder,
} from 'electric-sql/migrators/builder'
import {
  postgresConverter,
  sqliteConverter,
} from 'electric-sql/client'
import type { RunResult } from '@electric-sql/drivers'

setLogLevel('DEBUG')

let dbName: string
type DB = PgDatabase | BetterSqliteDatabase
const builder: QueryBuilder =
  dialect() === 'Postgres' ? pgBuilder : sqliteBuilder
const converter = dialect() === 'Postgres' ? postgresConverter : sqliteConverter

function dialect(): 'Postgres' | 'SQLite' {
  switch (process.env.DIALECT) {
    case 'Postgres':
    case 'SQLite':
      return process.env.DIALECT
    case '':
    case undefined:
      return 'SQLite'
    default:
      throw new Error(`Unrecognised dialect: ${process.env.DIALECT}`)
  }
}

async function makePgDatabase(): Promise<PgDatabase> {
  const client = new pg.Client({
    host: 'pg_1',
    port: 5432,
    database: dbName,
    user: 'postgres',
    password: 'password',
  })
  dbName = `${client.host}:${client.port}/${client.database}`
  await client.connect()

  return client
}

export const make_db = async (name: string): Promise<DB> => {
  dbName = name
  console.log('DIALECT: ' + process.env.DIALECT)

  switch (dialect()) {
    case 'Postgres':
      return makePgDatabase()
    case 'SQLite':
      return new SQLiteDatabase(name)
  }
}

function isPostgresDb(dialect: string | undefined, _db: DB): _db is PgDatabase {
  return dialect === 'Postgres'
}

export const electrify_db = async (
  db: DB,
  host: string,
  port: number,
  migrations: any,
  connectToElectric: boolean,
  exp?: string
): Promise<Electric> => {
  const config: ElectricConfig = {
    url: `electric://${host}:${port}`,
    debug: true,
  }
  console.log(`(in electrify_db) config: ${JSON.stringify(config)}`)

  switch (dialect()) {
    case 'Postgres':
      schema.pgMigrations = migrations
      break
    case 'SQLite':
      schema.migrations = migrations
      break
  }

  const electric = isPostgresDb(process.env.DIALECT, db)
    ? await electrifyPg(db, schema, config)
    : await electrifySqlite(db, schema, config)

  const token = await mockSecureAuthToken(exp)

  electric.notifier.subscribeToConnectivityStateChanges((x) =>
    console.log(`Connectivity state changed: ${x.connectivityState.status}`)
  )
  if (connectToElectric) {
    await electric.connect(token) // connect to Electric
  }

  return electric
}

export const disconnect = async (electric: Electric) => {
  await electric.disconnect()
}

// reconnects with Electric, e.g. after expiration of the JWT
export const reconnect = async (electric: Electric, exp: string) => {
  const token = await mockSecureAuthToken(exp)
  await electric.connect(token)
}

export const check_token_expiration = (
  electric: Electric,
  minimalTime: number
) => {
  const start = Date.now()
  const unsubscribe = electric.notifier.subscribeToConnectivityStateChanges(
    (x: any) => {
      if (
        x.connectivityState.status === 'disconnected' &&
        x.connectivityState.reason?.code === SatelliteErrorCode.AUTH_EXPIRED
      ) {
        const delta = Date.now() - start
        if (delta >= minimalTime) {
          console.log(`JWT expired after ${delta} ms`)
        } else {
          console.log(`JWT expired too early, after only ${delta} ms`)
        }
        unsubscribe()
      }
    }
  )
}

export const set_subscribers = (db: Electric) => {
  db.notifier.subscribeToAuthStateChanges((x: any) => {
    console.log('auth state changes: ')
    console.log(x)
  })
  db.notifier.subscribeToPotentialDataChanges((x: any) => {
    console.log('potential data change: ')
    console.log(x)
  })
  db.notifier.subscribeToDataChanges((x: any) => {
    console.log('data changes: ')
    console.log(JSON.stringify(x))
  })
}

export const syncTableWithShape = async (
  electric: Electric,
  table: keyof typeof schema.tables,
  shape: Record<string, any>
) => {
  const { synced } = await electric.sync.subscribe({ ...shape, table })
  return await synced
}

export const syncItemsTable = (electric: Electric, shapeFilter: string) => {
  return syncTableWithShape(electric, 'items', { where: shapeFilter })
}

export const syncOtherItemsTable = (
  electric: Electric,
  shapeFilter: string
) => {
  return syncTableWithShape(electric, 'other_items', { where: shapeFilter })
}

export const syncTable = async (table: string) => {
  const satellite: Satellite = globalRegistry.satellites[dbName as keyof typeof globalRegistry.satellites]
  const { synced } = await satellite.subscribe([{ tablename: table }])
  return await synced
}

export const lowLevelSubscribe = async (electric: Electric, shape: Shape) => {
  const { synced } = await electric.satellite.subscribe([shape])
  return await synced
}

export const get_tables = (electric: Electric) => {
  return electric.db.rawQuery(builder.getLocalTableNames())
}

export const get_columns = (electric: Electric, table: string) => {
  const namespace = builder.defaultNamespace
  const qualifiedTablename = new QualifiedTablename(namespace, table)
  return electric.db.rawQuery(builder.getTableInfo(qualifiedTablename))
}

export const get_rows = (electric: Electric, table: string) => {
  return electric.db.rawQuery({ sql: `SELECT * FROM ${table};` })
}

export const get_timestamps = (electric: Electric) => {
  return electric.db.rawQuery({ sql: 'SELECT * FROM timestamps;' })
}

type Timestamp = { id: string; created_at: Date; updated_at: Date }
type Datetime = { id: string; d: Date; t: Date }

export const write_timestamp = (
  electric: Electric,
  timestamp: Timestamp
): Promise<RunResult> => {
  const row = converter.encodeRow(timestamp, schema.tables.timestamps)
  return electric.adapter.run({
    sql: `INSERT INTO timestamps (id, created_at, updated_at) VALUES (${builder.makePositionalParam(
      1
    )}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)});`,
    args: [row.id, row.created_at, row.updated_at],
  })
}

export const write_datetime = (electric: Electric, datetime: Datetime) => {
  const row = converter.encodeRow(datetime, schema.tables.datetimes)
  return electric.adapter.run({
    sql: `INSERT INTO datetimes (id, d, t) VALUES (${builder.makePositionalParam(
      1
    )}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)});`,
    args: [row.id, row.d, row.t],
  })
}

export const get_timestamp = async (
  electric: Electric,
  id: string
): Promise<Timestamp | null> => {
  const result = await electric.db.rawQuery({
    sql: `SELECT * FROM timestamps WHERE id = ${builder.makePositionalParam(
      1
    )};`,
    args: [id],
  })
  return result.length === 1
    ? converter.decodeRow<Timestamp>(result[0], schema.tables.timestamps)
    : null
}

export const get_datetime = async (
  electric: Electric,
  id: string
): Promise<Datetime | null> => {
  const res = await electric.db.rawQuery({
    sql: `SELECT * FROM datetimes WHERE id = ${builder.makePositionalParam(
      1
    )};`,
    args: [id],
  })
  const datetime = res.length === 1
    ? converter.decodeRow<Datetime>(res[0], schema.tables.datetimes)
    : null
  console.log(`Found date time?:\n${JSON.stringify(datetime, undefined, 2)}`)
  return datetime
}

export const assert_timestamp = async (
  electric: Electric,
  id: string,
  expectedCreatedAt: string,
  expectedUpdatedAt: string
) => {
  const timestamp = await get_timestamp(electric, id)
  return check_timestamp(timestamp, expectedCreatedAt, expectedUpdatedAt)
}

export const assert_datetime = async (
  electric: Electric,
  id: string,
  expectedDate: string,
  expectedTime: string
) => {
  const datetime = await get_datetime(electric, id)
  return check_datetime(datetime, expectedDate, expectedTime)
}

export const check_timestamp = (
  timestamp: Timestamp | null,
  expectedCreatedAt: string,
  expectedUpdatedAt: string
) => {
  console.log("Timestamp: " + JSON.stringify(timestamp))
  console.log("Created at: " + timestamp?.created_at.getTime())
  console.log("Expected created at: " + new Date(expectedCreatedAt).getTime())
  console.log("Updated at: " + timestamp?.updated_at.getTime())
  console.log("Expected updated at: " + new Date(expectedUpdatedAt).getTime())
  return (
    (timestamp ?? false) &&
    timestamp!.created_at.getTime() === new Date(expectedCreatedAt).getTime() &&
    timestamp!.updated_at.getTime() === new Date(expectedUpdatedAt).getTime()
  )
}

export const check_datetime = (
  datetime: Datetime | null,
  expectedDate: string,
  expectedTime: string
) => {
  return (
    (datetime ?? false) &&
    datetime!.d.getTime() === new Date(expectedDate).getTime() &&
    datetime!.t.getTime() === new Date(expectedTime).getTime()
  )
}

export const write_bool = async (electric: Electric, id: string, b: boolean) => {
  const bool = converter.encode(b, schema.tables.bools.fields.b)
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO bools (id, b) VALUES (${builder.makePositionalParam(
      1
    )}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [id, bool],
  })
  return converter.decodeRow<{ id: string; b: boolean }>(row, schema.tables.bools)
}

export const get_bool = async (electric: Electric, id: string) => {
  const res = await electric.db.rawQuery({
    sql: `SELECT b FROM bools WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  const row = res.length === 1
    ? converter.decodeRow<{ id: string, b: boolean }>(res[0], schema.tables.bools)
    : null
  return row?.b
}

export const get_datetimes = async (electric: Electric) => {
  const rows = await electric.db.rawQuery({ sql: 'SELECT * FROM datetimes;' })
  return converter.decodeRows<Datetime>(rows, schema.tables.datetimes)
}

type Item = {
  id: string
  content: string
  context_text_null: string | null,
  context_text_null_default: string,
  intvalue_null: number | null,
  intvalue_null_default: number,
}

export const get_items = async (electric: Electric) => {
  const rows = await electric.db.rawQuery({ sql: 'SELECT * FROM items;' })
  return converter.decodeRows<Item>(rows, schema.tables.items)
}

export const get_item_ids_raw = async (electric: Electric) => {
  const rows = await electric.db.rawQuery({ sql: 'SELECT id FROM items;' })
  return rows as Array<Pick<Item, 'id'>>
}

export const get_uuid = async (electric: Electric, id: string) => {
  const res = await electric.db.rawQuery({
    sql: `SELECT * FROM uuids WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  if (res.length === 1) {
    return res[0] as { id: string }
  }
  return null
}

export const get_uuids = async (electric: Electric) => {
  return electric.db.rawQuery({ sql: 'SELECT * FROM uuids;' })
}

export const write_uuid = async (electric: Electric, id: string) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO uuids (id) VALUES (${builder.makePositionalParam(1)}) RETURNING *;`,
    args: [id],
  })
  return row
}

type Int = {
  id: string
  i2: number
  i4: number
  i8: bigint
}

export const get_int = async (electric: Electric, id: string) => {
  // Need to cast i8 to text because better-sqlite3 does return a BigInt by default
  // unless we activate BigInt support but then it returns all numbers as BigInt.
  // The DAL applies the same cast when reading from an INT8 table.
  const rows = await electric.db.rawQuery({
    sql: `SELECT id, i2, i4, cast(i8 AS TEXT) AS i8 FROM ints WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  if (rows.length === 1) {
    const row = rows[0]
    return converter.decodeRow<Int>(row, schema.tables.ints)
  }
  return null
}

export const write_int = async (
  electric: Electric,
  id: string,
  i2: number,
  i4: number,
  i8: number | bigint
) => {
  // Do some manual range checks in order to throw the same errors as the DAL does
  // because some e2e tests check these errors
  if (i2 < -32768) {
    throw new Error('Number must be greater or equal to -32768')
  }
  if (i2 > 32767) {
    throw new Error('Number must be less than or equal to 32767')
  }
  if (i4 < -2147483648) {
    throw new Error('Number must be greater than or equal to -2147483648')
  }
  if (i4 > 2147483647) {
    throw new Error('Number must be less than or equal to 2147483647')
  }
  if (i8 < -9223372036854775808n) {
    throw new Error('BigInt must be greater than or equal to -9223372036854775808')
  }
  if (i8 > 9223372036854775807n) {
    throw new Error('BigInt must be less than or equal to 9223372036854775807')
  }

  const r = converter.encodeRow({ id, i2, i4, i8 }, schema.tables.ints)

  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO ints (id, i2, i4, i8) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)}, ${builder.makePositionalParam(4)}) RETURNING id, i2, i4, cast(i8 AS TEXT) AS i8;`,
    args: [r.id, r.i2, r.i4, r.i8],
  })
  return converter.decodeRow<Int>(row, schema.tables.ints)
}

type Float = {
  id: string
  f4: number
  f8: number
}

export const get_float = async (electric: Electric, id: string) => {
  const rows = await electric.db.rawQuery({
    sql: `SELECT * FROM floats WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  if (rows.length === 1) {
    const row = rows[0]
    return converter.decodeRow<Float>(row, schema.tables.floats)
  }
  return null
}

export const write_float = async (
  electric: Electric,
  id: string,
  f4: number,
  f8: number
) => {
  const r = converter.encodeRow({ id, f4, f8 }, schema.tables.floats)
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO floats (id, f4, f8) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)}) RETURNING *;`,
    args: [r.id, r.f4, r.f8],
  })
  return converter.decodeRow<Float>(row, schema.tables.floats)
}

export const get_json_raw = async (electric: Electric, id: string) => {
  const res = (await electric.db.rawQuery({
    sql: `SELECT js FROM jsons WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })) as unknown as Array<{ js: string }>
  return res[0]?.js
}

export const get_jsonb_raw = async (electric: Electric, id: string) => {
  const res = (await electric.db.rawQuery({
    sql: `SELECT jsb FROM jsons WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })) as unknown as Array<{ jsb: string }>

  const js = res[0]?.jsb

  if (builder.dialect === 'Postgres') {
    return js
  }

  return JSON.parse(js) // SQLite stores JSON as string so parse it
}

export const get_json = async (electric: Electric, id: string) => {
  const rows = await electric.db.rawQuery({
    sql: `SELECT id FROM jsons WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })

  if (rows.length === 1) {
    const row = rows[0]
    return row as { id: string }
  }
  return null
}

export const get_jsonb = async (electric: Electric, id: string) => {
  const rows = await electric.db.rawQuery({
    sql: `SELECT id, jsb FROM jsons WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })

  if (rows.length === 1) {
    const row = rows[0]
    return converter.decodeRow<{ id: string, jsb: any }>(row, schema.tables.jsons)
  }
  return null
}

export const write_json = async (electric: Electric, id: string, jsb: any) => {
  const r = converter.encodeRow({ id, jsb }, schema.tables.jsons)
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO jsons (id, jsb) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [r.id, r.jsb],
  })
  return converter.decodeRow<{ id: string, jsb: any }>(row, schema.tables.jsons)
}

type Color = "RED" | "GREEN" | "BLUE"

type Enum = {
  id: string
  c: Color | null
}

export const get_enum = async (electric: Electric, id: string) => {
  const res = await electric.db.rawQuery({
    sql: `SELECT * FROM enums WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  if (res.length === 1) {
    const row = res[0]
    return row as { id: string, c: Color | null }
  }
  return null
}

export const write_enum = async (electric: Electric, id: string, c: Color | null) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO enums (id, c) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [id, c],
  })
  return converter.decodeRow<Enum>(row, schema.tables.enums)
}

export const get_blob = async (electric: Electric, id: string) => {
  const res = await electric.db.rawQuery({
    sql: `SELECT * FROM blobs WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  if (res.length === 1) {
    const row = res[0] as { blob: Uint8Array }
    if (row?.blob) {
      row.blob = new Uint8Array(row.blob)
    }
    return row
  }
  return null
}

export const write_blob = async (
  electric: Electric,
  id: string,
  blob: Uint8Array | null
) => {
  const r = converter.encodeRow({ id, blob }, schema.tables.blobs)
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO blobs (id, blob) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [r.id, r.blob],
  })
  return converter.decodeRow<{ id: string, blob: Uint8Array | null }>(row, schema.tables.blobs)
}

export const get_item_columns = (
  electric: Electric,
  table: string,
  column: string
) => {
  return electric.db.rawQuery({ sql: `SELECT ${column} FROM ${table};` })
}

export const insert_items = async (electric: Electric, keys: [string]) => {
  const items = keys.map((k) => {
    return {
      id: uuidv4(),
      content: k,
    }
  })

  await electric.adapter.run({
    sql: `INSERT INTO items (id, content) VALUES ${items
      .map((_, i) => `(${builder.makePositionalParam(2 * i + 1)}, ${builder.makePositionalParam(2 * i + 2)})`)
      .join(', ')};`,
    args: items.flatMap((item) => [item.id, item.content]),
  })
}

export const insert_item = async (electric: Electric, id: string, content: string) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO items (id, content) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [id, content],
  })
  return converter.decodeRow<Item>(row, schema.tables.items)
}

export const insert_extended_item = async (
  electric: Electric,
  values: Record<string, string>
) => {
  await insert_extended_into(electric, 'items', values)
}

export const insert_extended_into = async (
  electric: Electric,
  table: string,
  values: Record<string, string>
) => {
  if (!values['id']) {
    values['id'] = uuidv4()
  }
  const columns = Object.keys(values)
  const columnNames = columns.join(', ')
  const placeHolders = columns.map((_, i) => builder.makePositionalParam(i + 1))
  const args = Object.values(values)

  await electric.db.unsafeExec({
    sql: `INSERT INTO ${table} (${columnNames}) VALUES (${placeHolders}) RETURNING *;`,
    args: args,
  })
}

export const delete_item = async (electric: Electric, keys: [string]) => {
  for (const key of keys) {
    await electric.adapter.run({
      sql: `DELETE FROM items WHERE content = ${builder.makePositionalParam(1)};`,
      args: [key],
    })
  }
}

export const get_other_items = async (electric: Electric) => {
  return electric.db.rawQuery({ sql: 'SELECT * FROM other_items;' })
}

export const insert_other_items = async (electric: Electric, keys: [string]) => {
  const items = keys.map((k) => {
    return {
      id: uuidv4(),
      content: k,
    }
  })

  await electric.adapter.run({
    sql: `INSERT INTO other_items (id, content) VALUES ${items
      .map((_, i) => `(${builder.makePositionalParam(2 * i + 1)}, ${builder.makePositionalParam(2 * i + 2)})`)
      .join(', ')};`,
    args: items.flatMap((item) => [item.id, item.content]),
  })
}

export const insert_other_item = async (electric: Electric, id: string, content: string, item_id: string) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO other_items (id, content, item_id) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)}) RETURNING *;`,
    args: [id, content, item_id],
  })
  return converter.decodeRow<Item>(row, schema.tables.other_items)
}

export const delete_other_item = async (electric: Electric, keys: [string]) => {
  for (const key of keys) {
    await electric.adapter.run({
      sql: `DELETE FROM other_items WHERE content = ${builder.makePositionalParam(1)};`,
      args: [key],
    })
  }
}

const replicationTransformer = {
  transformOutbound: (item: Readonly<Item>) => ({
    ...item,
    content: item.content
      .split('')
      .map((char) => String.fromCharCode(char.charCodeAt(0) + 1))
      .join(''),
  }),
  transformInbound: (item: Readonly<Item>) => ({
    ...item,
    content: item.content
      .split('')
      .map((char) => String.fromCharCode(char.charCodeAt(0) - 1))
      .join(''),
  }),
}

export const set_item_replication_transform = (electric: Electric) => {
  const namespace = builder.defaultNamespace
  electric.setReplicationTransform<Item>(
    new QualifiedTablename(namespace, 'items'),
    replicationTransformer
  )
}

export const stop = async () => {
  await globalRegistry.stopAll()
}
