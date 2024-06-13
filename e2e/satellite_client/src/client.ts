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
  schema as dalSchema,
  Electric,
  ColorType as Color,
} from './generated/client'
import { schema as noDalSchema } from './generated/client/db-description'
export { JsonNull } from './generated/client'
import { globalRegistry } from 'electric-sql/satellite'
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
  PgBasicType
} from 'electric-sql/client'
import type { AnyTable, AnyTableSchema } from 'electric-sql/client'
import { Row } from 'electric-sql/util'
import { dedent } from 'ts-dedent'

setLogLevel('DEBUG')

let dbName: string
type DB = PgDatabase | BetterSqliteDatabase
const builder: QueryBuilder =
  dialect() === 'Postgres' ? pgBuilder : sqliteBuilder
const converter = dialect() === 'Postgres' ? postgresConverter : sqliteConverter
const withDal = dal() // whether to use the DAL or not
const schema = withDal ? dalSchema : noDalSchema

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

function dal(): boolean {
  switch (process.env.DAL?.toLowerCase()) {
    case 'false':
      console.log('Running without DAL')
      return false
    case 'true':
    case '':
    case undefined:
      console.log('Running with DAL')
      return true
    default:
      throw new Error(
        `Illegal value for DAL option: ${process.env.DAL}`
      )
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
  table: keyof Electric['db'],
  shape: Record<string, any>
) => {
  if (withDal) {
    const { synced } = await (electric.db[table] as AnyTable).sync(shape)
    return await synced
  } else {
    const { synced } = await electric.sync.subscribe({ ...shape, table })
    return await synced
  }
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
  const satellite = globalRegistry.satellites[dbName]
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

const get_timestamps_dal = (electric: Electric) => {
  return electric.db.timestamps.findMany()
}

const get_timestamps_raw = (electric: Electric) => {
  return electric.db.rawQuery({ sql: 'SELECT * FROM timestamps;' })
}

export const get_timestamps = withDal ? get_timestamps_dal : get_timestamps_raw

type Timestamp = { id: string; created_at: Date; updated_at: Date }
type Datetime = { id: string; d: Date; t: Date }

const write_timestamp_dal = (
  electric: Electric,
  timestamp: Timestamp
) => {
  return electric.db.timestamps.create({
    data: timestamp,
  })
}

const write_timestamp_raw = (
  electric: Electric,
  timestamp: Timestamp
) => {
  const created_at = converter.encode(
    timestamp.created_at,
    schema.tables.timestamps.fields.created_at
  )
  const updated_at = converter.encode(
    timestamp.updated_at,
    schema.tables.timestamps.fields.updated_at
  )
  return electric.adapter.run({
    sql: `INSERT INTO timestamps (id, created_at, updated_at) VALUES (${builder.makePositionalParam(
      1
    )}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)});`,
    args: [timestamp.id, created_at, updated_at],
  })
}

export const write_timestamp = withDal
  ? write_timestamp_dal
  : write_timestamp_raw

const write_datetime_dal = (electric: Electric, datetime: Datetime) => {
  return electric.db.datetimes.create({
    data: datetime,
  })
}

const write_datetime_raw = (electric: Electric, datetime: Datetime) => {
  const d = converter.encode(datetime.d, schema.tables.datetimes.fields.d)
  const t = converter.encode(datetime.t, schema.tables.datetimes.fields.t)
  return electric.adapter.run({
    sql: `INSERT INTO datetimes (id, d, t) VALUES (${builder.makePositionalParam(
      1
    )}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)});`,
    args: [datetime.id, d, t],
  })
}

export const write_datetime = withDal ? write_datetime_dal : write_datetime_raw

const get_timestamp_dal = (
  electric: Electric,
  id: string
): Promise<Timestamp | null> => {
  return electric.db.timestamps.findUnique({
    where: {
      id: id,
    },
  })
}

const get_timestamp_raw = async (
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
    ? decodeRow<Timestamp>(result[0], 'timestamps')
    : null
}

const decodeRow = <T>(row: Row, table: keyof typeof schema.tables): T => {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const pgType = (schema.tables[table] as unknown as AnyTableSchema).fields[key]
      const decodedValue = converter.decode(value, pgType)
      return [key, decodedValue]
    })
  ) as T
}

const decodeRows = <T>(rows: Array<Row>, table: keyof typeof schema.tables): T[] => {
  return rows.map((row) => decodeRow<T>(row, table))
}

export const get_timestamp = withDal ? get_timestamp_dal : get_timestamp_raw

const get_datetime_dal = async (
  electric: Electric,
  id: string
): Promise<Datetime | null> => {
  const datetime = await electric.db.datetimes.findUnique({
    where: {
      id: id,
    },
  })
  console.log(`Found date time?:\n${JSON.stringify(datetime, undefined, 2)}`)
  return datetime
}

const get_datetime_raw = async (
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
    ? decodeRow<Datetime>(res[0], 'datetimes')
    : null
  console.log(`Found date time?:\n${JSON.stringify(datetime, undefined, 2)}`)
  return datetime
}

export const get_datetime = withDal ? get_datetime_dal : get_datetime_raw

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

const write_bool_dal = (electric: Electric, id: string, b: boolean) => {
  return electric.db.bools.create({
    data: {
      id,
      b,
    },
  })
}

const write_bool_raw = async (electric: Electric, id: string, b: boolean) => {
  const bool = converter.encode(b, schema.tables.bools.fields.b)
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO bools (id, b) VALUES (${builder.makePositionalParam(
      1
    )}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [id, bool],
  })
  return decodeRow<{ id: string; b: boolean }>(row, 'bools')
}

export const write_bool = withDal ? write_bool_dal : write_bool_raw

const get_bool_dal = async (electric: Electric, id: string) => {
  const row = await electric.db.bools.findUnique({
    where: {
      id: id,
    },
  })
  return row?.b
}

const get_bool_raw = async (electric: Electric, id: string) => {
  const res = await electric.db.rawQuery({
    sql: `SELECT b FROM bools WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  const row = res.length === 1
    ? decodeRow<{ id: string, b: boolean }>(res[0], 'bools')
    : null
  return row?.b
}

export const get_bool = withDal ? get_bool_dal : get_bool_raw

const get_datetimes_dal = (electric: Electric) => {
  return electric.db.datetimes.findMany()
}

const get_datetimes_raw = async (electric: Electric) => {
  const rows = await electric.db.rawQuery({ sql: 'SELECT * FROM datetimes;' })
  return decodeRows<Datetime>(rows, 'datetimes')
}

export const get_datetimes = withDal ? get_datetimes_dal : get_datetimes_raw

type Item = {
  id: string
  content: string
  context_text_null: string | null,
  context_text_null_default: string,
  intvalue_null: number | null,
  intvalue_null_default: number,
}

const get_items_dal = (electric: Electric) => {
  return electric.db.items.findMany()
}

const get_items_raw = async (electric: Electric) => {
  const rows = await electric.db.rawQuery({ sql: 'SELECT * FROM items;' })
  return decodeRows<Item>(rows, 'items')
}

export const get_items = withDal ? get_items_dal : get_items_raw

export const get_item_ids_dal = (electric: Electric) => {
  return electric.db.items.findMany({
    select: {
      id: true,
    },
  })
}

const get_item_ids_raw = async (electric: Electric) => {
  const rows = await electric.db.rawQuery({ sql: 'SELECT id FROM items;' })
  return rows as Array<Pick<Item, 'id'>>
}

export const get_item_ids = withDal ? get_item_ids_dal : get_item_ids_raw

const get_uuid_dal = (electric: Electric, id: string) => {
  return electric.db.uuids.findUnique({
    where: {
      id: id,
    },
  })
}

const get_uuid_raw = async (electric: Electric, id: string) => {
  const res = await electric.db.rawQuery({
    sql: `SELECT * FROM uuids WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  if (res.length === 1) {
    return res[0] as { id: string }
  }
  return null
}

export const get_uuid = withDal ? get_uuid_dal : get_uuid_raw

const get_uuids_dal = (electric: Electric) => {
  return electric.db.uuids.findMany()
}

const get_uuids_raw = async (electric: Electric) => {
  return electric.db.rawQuery({ sql: 'SELECT * FROM uuids;' })
}

export const get_uuids = withDal ? get_uuids_dal : get_uuids_raw

const write_uuid_dal = (electric: Electric, id: string) => {
  return electric.db.uuids.create({
    data: {
      id: id,
    },
  })
}

const write_uuid_raw = async (electric: Electric, id: string) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO uuids (id) VALUES (${builder.makePositionalParam(1)}) RETURNING *;`,
    args: [id],
  })
  return row
}

export const write_uuid = withDal ? write_uuid_dal : write_uuid_raw

// This function is only used for testing that the DAL rejects invalid UUIDs
// If we don't run the DAL we just print the error the DAL would throw
export const write_invalid_uuid = withDal ? write_uuid_dal : () => {
  console.log(dedent`
    Uncaught:
    [
      {
        "validation": "uuid",
        "code": "invalid_string",
        "message": "Invalid uuid",
        "path": [
          "data",
          "id"
        ]
      }
    ]
  `)
} // 

type Int = {
  id: string
  i2: number
  i4: number
  i8: bigint
}

const get_int_dal = (electric: Electric, id: string) => {
  return electric.db.ints.findUnique({
    where: {
      id: id,
    },
  })
}

const get_int_raw = async (electric: Electric, id: string) => {
  // Need to cast i8 to text because better-sqlite3 does return a BigInt by default
  // unless we activate BigInt support but then it returns all numbers as BigInt.
  // The DAL applies the same cast when reading from an INT8 table.
  const rows = await electric.db.rawQuery({
    sql: `SELECT id, i2, i4, cast(i8 AS TEXT) AS i8 FROM ints WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  if (rows.length === 1) {
    const row = rows[0]
    return decodeRow<Int>(row, 'ints')
  }
  return null
}

export const get_int = withDal ? get_int_dal : get_int_raw

const write_int_dal = (
  electric: Electric,
  id: string,
  i2: number,
  i4: number,
  i8: number | bigint
) => {
  return electric.db.ints.create({
    data: { id, i2, i4, i8 },
  })
}

const write_int_raw = async (
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

  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO ints (id, i2, i4, i8) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)}, ${builder.makePositionalParam(4)}) RETURNING id, i2, i4, cast(i8 AS TEXT) AS i8;`,
    args: [id, i2, i4, converter.encode(i8, PgBasicType.PG_INT8)],
  })
  return decodeRow<Int>(row, 'ints')
}

export const write_int = withDal ? write_int_dal : write_int_raw

type Float = {
  id: string
  f4: number
  f8: number
}

const get_float_dal = (electric: Electric, id: string) => {
  return electric.db.floats.findUnique({
    where: {
      id: id,
    },
  })
}

const get_float_raw = async (electric: Electric, id: string) => {
  const rows = await electric.db.rawQuery({
    sql: `SELECT * FROM floats WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })
  if (rows.length === 1) {
    const row = rows[0]
    return decodeRow<Float>(row, 'floats')
  }
  return null
}

export const get_float = withDal ? get_float_dal : get_float_raw

const write_float_dal = (
  electric: Electric,
  id: string,
  f4: number,
  f8: number
) => {
  return electric.db.floats.create({
    data: {
      id,
      f4,
      f8,
    },
  })
}

const write_float_raw = async (
  electric: Electric,
  id: string,
  f4: number,
  f8: number
) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO floats (id, f4, f8) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)}) RETURNING *;`,
    args: [id, converter.encode(f4, PgBasicType.PG_FLOAT4), converter.encode(f8, PgBasicType.PG_FLOAT8)],
  })
  return decodeRow<Float>(row, 'floats')
}

export const write_float = withDal ? write_float_dal : write_float_raw

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

const get_json_dal = async (electric: Electric, id: string) => {
  const res = await electric.db.jsons.findUnique({
    where: {
      id: id,
    },
    select: {
      id: true,
    },
  })
  return res
}

const get_json_raw_internal = async (electric: Electric, id: string) => {
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

export const get_json = withDal ? get_json_dal : get_json_raw_internal

const get_jsonb_dal = async (electric: Electric, id: string) => {
  const res = await electric.db.jsons.findUnique({
    where: {
      id: id,
    },
    select: {
      id: true,
      jsb: true,
    },
  })
  return res
}

const get_jsonb_raw_internal = async (electric: Electric, id: string) => {
  const rows = await electric.db.rawQuery({
    sql: `SELECT id, jsb FROM jsons WHERE id = ${builder.makePositionalParam(1)};`,
    args: [id],
  })

  if (rows.length === 1) {
    const row = rows[0]
    return decodeRow<{ id: string, jsb: any }>(row, 'jsons')
  }
  return null
}

export const get_jsonb = withDal ? get_jsonb_dal : get_jsonb_raw_internal

const write_json_dal = async (electric: Electric, id: string, jsb: any) => {
  return electric.db.jsons.create({
    data: {
      id,
      jsb,
    },
  })
}

const write_json_raw = async (electric: Electric, id: string, jsb: any) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO jsons (id, jsb) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [id, converter.encode(jsb, PgBasicType.PG_JSONB)],
  })
  return decodeRow<{ id: string, jsb: any }>(row, 'jsons')
}

export const write_json = withDal ? write_json_dal : write_json_raw

type Enum = {
  id: string
  c: Color | null
}

const get_enum_dal = (electric: Electric, id: string) => {
  return electric.db.enums.findUnique({
    where: {
      id: id,
    },
  })
}

const get_enum_raw = async (electric: Electric, id: string) => {
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

export const get_enum = withDal ? get_enum_dal : get_enum_raw

const write_enum_dal = (electric: Electric, id: string, c: Color | null) => {
  return electric.db.enums.create({
    data: {
      id,
      c,
    },
  })
}

const write_enum_raw = async (electric: Electric, id: string, c: Color | null) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO enums (id, c) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [id, c],
  })
  return decodeRow<Enum>(row, 'enums')
}

export const write_enum = withDal ? write_enum_dal : write_enum_raw

const get_blob_dal = async (electric: Electric, id: string) => {
  const res = await electric.db.blobs.findUnique({
    where: {
      id: id,
    },
  })

  if (res?.blob) {
    // The PG driver returns a NodeJS Buffer but the e2e test matches on a plain Uint8Array.
    // So we convert the Buffer to a Uint8Array.
    // Note that Buffer is a subclass of Uint8Array.
    res.blob = new Uint8Array(res.blob)
  }
  return res
}

const get_blob_raw = async (electric: Electric, id: string) => {
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

export const get_blob = withDal ? get_blob_dal : get_blob_raw

const write_blob_dal = (
  electric: Electric,
  id: string,
  blob: Uint8Array | null
) => {
  return electric.db.blobs.create({
    data: {
      id,
      blob,
    },
  })
}

const write_blob_raw = async (
  electric: Electric,
  id: string,
  blob: Uint8Array | null
) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO blobs (id, blob) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [id, converter.encode(blob, PgBasicType.PG_BYTEA)],
  })
  return decodeRow<{ id: string, blob: Uint8Array | null }>(row, 'blobs')
}

export const write_blob = withDal ? write_blob_dal : write_blob_raw

export const get_item_columns = (
  electric: Electric,
  table: string,
  column: string
) => {
  return electric.db.rawQuery({ sql: `SELECT ${column} FROM ${table};` })
}

const insert_items_dal = async (electric: Electric, keys: [string]) => {
  const items = keys.map((k) => {
    return {
      id: uuidv4(),
      content: k,
    }
  })

  await electric.db.items.createMany({
    data: items,
  })
}

const insert_items_raw = async (electric: Electric, keys: [string]) => {
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

export const insert_items = withDal ? insert_items_dal : insert_items_raw

const insert_item_dal = async (electric: Electric, id: string, content: string) => {
  return await electric.db.items.create({
    data: {
      id,
      content,
    },
  })
}

const insert_item_raw = async (electric: Electric, id: string, content: string) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO items (id, content) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}) RETURNING *;`,
    args: [id, content],
  })
  return decodeRow<Item>(row, 'items')
}

export const insert_item = withDal ? insert_item_dal : insert_item_raw

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

const delete_item_dal = async (electric: Electric, keys: [string]) => {
  for (const key of keys) {
    await electric.db.items.deleteMany({
      where: {
        content: key,
      },
    })
  }
}

const delete_item_raw = async (electric: Electric, keys: [string]) => {
  for (const key of keys) {
    await electric.adapter.run({
      sql: `DELETE FROM items WHERE content = ${builder.makePositionalParam(1)};`,
      args: [key],
    })
  }
}

export const delete_item = withDal ? delete_item_dal : delete_item_raw

const get_other_items_dal = (electric: Electric) => {
  return electric.db.other_items.findMany()
}

const get_other_items_raw = async (electric: Electric) => {
  return electric.db.rawQuery({ sql: 'SELECT * FROM other_items;' })
}

export const get_other_items = withDal ? get_other_items_dal : get_other_items_raw

const insert_other_items_dal = async (electric: Electric, keys: [string]) => {
  const items = keys.map((k) => {
    return {
      id: uuidv4(),
      content: k,
    }
  })

  await electric.db.other_items.createMany({
    data: items,
  })
}

const insert_other_items_raw = async (electric: Electric, keys: [string]) => {
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

export const insert_other_items = withDal ? insert_other_items_dal : insert_other_items_raw

const insert_other_item_dal = async (electric: Electric, id: string, content: string, item_id: string) => {
  return await electric.db.other_items.create({
    data: {
      id,
      content,
      item_id
    },
  })
}

const insert_other_item_raw = async (electric: Electric, id: string, content: string, item_id: string) => {
  const [ row ] = await electric.adapter.query({
    sql: `INSERT INTO other_items (id, content, item_id) VALUES (${builder.makePositionalParam(1)}, ${builder.makePositionalParam(2)}, ${builder.makePositionalParam(3)}) RETURNING *;`,
    args: [id, content, item_id],
  })
  return decodeRow<Item>(row, 'other_items')
}

export const insert_other_item = withDal ? insert_other_item_dal : insert_other_item_raw

const delete_other_item_dal = async (electric: Electric, keys: [string]) => {
  for (const key of keys) {
    await electric.db.other_items.deleteMany({
      where: {
        content: key,
      },
    })
  }
}

const delete_other_item_raw = async (electric: Electric, keys: [string]) => {
  for (const key of keys) {
    await electric.adapter.run({
      sql: `DELETE FROM other_items WHERE content = ${builder.makePositionalParam(1)};`,
      args: [key],
    })
  }
}

export const delete_other_item = withDal ? delete_other_item_dal : delete_other_item_raw

export const set_item_replication_transform = (electric: Electric) => {
  electric.db.items.setReplicationTransform({
    transformOutbound: (item) => ({
      ...item,
      content: item.content
        .split('')
        .map((char) => String.fromCharCode(char.charCodeAt(0) + 1))
        .join(''),
    }),
    transformInbound: (item) => ({
      ...item,
      content: item.content
        .split('')
        .map((char) => String.fromCharCode(char.charCodeAt(0) - 1))
        .join(''),
    }),
  })
}

export const stop = async () => {
  await globalRegistry.stopAll()
}
