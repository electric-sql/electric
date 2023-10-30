import Database from 'better-sqlite3'
import { ElectricConfig } from 'electric-sql'
import { mockSecureAuthToken } from 'electric-sql/auth/secure'

import { setLogLevel } from 'electric-sql/debug'
import { electrify } from 'electric-sql/node'
import { v4 as uuidv4 } from 'uuid'
import { schema, Electric } from './generated/client'
import { globalRegistry } from 'electric-sql/satellite'

setLogLevel('DEBUG')

let dbName: string

export const make_db = (name: string): any => {
  dbName = name
  return new Database(name)
}

export const electrify_db = async (
  db: any,
  host: string,
  port: number,
  migrations: any
): Promise<Electric> => {
  const config: ElectricConfig = {
    url: `electric://${host}:${port}`,
    debug: true,
    auth: {
      token: await mockSecureAuthToken()
    }
  }
  console.log(`(in electrify_db) config: ${JSON.stringify(config)}`)
  schema.migrations = migrations
  const result = await electrify(db, schema, config)

  result.notifier.subscribeToConnectivityStateChanges((x) => console.log("Connectivity state changed", x))

  return result
}

export const set_subscribers = (db: Electric) => {
  db.notifier.subscribeToAuthStateChanges((x) => {
    console.log('auth state changes: ')
    console.log(x)
  })
  db.notifier.subscribeToPotentialDataChanges((x) => {
    console.log('potential data change: ')
    console.log(x)
  })
  db.notifier.subscribeToDataChanges((x) => {
    console.log('data changes: ')
    console.log(JSON.stringify(x))
  })
}

export const syncTable = async (electric: Electric, table: string) => {
  if (table === 'other_items') {
    const { synced } = await electric.db.other_items.sync({ include: { items: true } })
    return await synced
  } else {
    const satellite = globalRegistry.satellites[dbName]
    const { synced } = await satellite.subscribe([{selects: [{tablename: table}]}])
    return await synced
  }
}

export const get_tables = (electric: Electric) => {
  return electric.db.raw({ sql: `SELECT name FROM sqlite_master WHERE type='table';` })
}

export const get_columns = (electric: Electric, table: string) => {
  return electric.db.raw({ sql: `SELECT * FROM pragma_table_info(?);`, args: [table] })
}

export const get_rows = (electric: Electric, table: string) => {
  return electric.db.raw({sql: `SELECT * FROM ${table};`})
}

export const get_timestamps = (electric: Electric) => {
  return electric.db.timestamps.findMany()
}

type Timestamp = { id: string, created_at: Date, updated_at: Date }
type Datetime = { id: string, d: Date, t: Date }

export const write_timestamp = (electric: Electric, timestamp: Timestamp) => {
  return electric.db.timestamps.create({
    data: timestamp
  })
}

export const write_datetime = (electric: Electric, datetime: Datetime) => {
  return electric.db.datetimes.create({
    data: datetime
  })
}

export const get_timestamp = (electric: Electric, id: string): Promise<Timestamp | undefined> => {
  return electric.db.timestamps.findUnique({
    where: {
      id: id
    }
  })
}

export const get_datetime = async (electric: Electric, id: string): Promise<Datetime | undefined> => {
  const datetime = await electric.db.datetimes.findUnique({
    where: {
      id: id
    }
  })
  console.log(`Found date time?:\n${JSON.stringify(datetime, undefined, 2)}`)
  return datetime
}

export const assert_timestamp = async (electric: Electric, id: string, expectedCreatedAt: string, expectedUpdatedAt: string) => {
  const timestamp = await get_timestamp(electric, id)
  return check_timestamp(timestamp, expectedCreatedAt, expectedUpdatedAt)
}

export const assert_datetime = async (electric: Electric, id: string, expectedDate: string, expectedTime: string) => {
  const datetime = await get_datetime(electric, id)
  return check_datetime(datetime, expectedDate, expectedTime)
}

export const check_timestamp = (timestamp: Timestamp | undefined, expectedCreatedAt: string, expectedUpdatedAt: string) => {
  return (timestamp ?? false) &&
    timestamp!.created_at.getTime() === new Date(expectedCreatedAt).getTime() &&
    timestamp!.updated_at.getTime() === new Date(expectedUpdatedAt).getTime()
}

export const check_datetime = (datetime: Datetime | undefined, expectedDate: string, expectedTime: string) => {
  return (datetime ?? false) &&
    datetime!.d.getTime() === new Date(expectedDate).getTime() &&
    datetime!.t.getTime() === new Date(expectedTime).getTime()
}

export const get_datetimes = (electric: Electric) => {
  return electric.db.datetimes.findMany()
}

export const get_items = (electric: Electric) => {
  return electric.db.items.findMany({})
}

export const get_item_ids = (electric: Electric) => {
  return electric.db.items.findMany({
    select: {
      id: true
    }
  })
}

export const get_item_columns = (electric: Electric, table: string, column: string) => {
  return electric.db.raw({ sql: `SELECT ${column} FROM ${table};` })
}

export const insert_item = async (electric: Electric, keys: [string]) => {
  const items = keys.map(k => {
    return {
      id: uuidv4(),
      content: k
    }
  })

  await electric.db.items.createMany({
    data: items
  })
}

export const insert_extended_item = async (electric: Electric, values: { string: string }) => {
  await insert_extended_into(electric, "items", values)
}

export const insert_extended_into = async (electric: Electric, table: string, values: { string: string }) => {
  if (!values['id']) {
    values['id'] = uuidv4()
  }
  const columns = Object.keys(values)
  const columnNames = columns.join(", ")
  const placeHolders = Array(columns.length).fill("?")
  const args = Object.values(values)

  await electric.db.raw({
    sql: `INSERT INTO ${table} (${columnNames}) VALUES (${placeHolders}) RETURNING *;`,
    args: args,
  })
}

export const delete_item = async (electric: Electric, keys: [string]) => {
  for (const key of keys) {
    await electric.db.items.deleteMany({
      where: {
        content: key
      }
    })
  }
}

export const get_other_items = (electric: Electric) => {
  return electric.db.other_items.findMany()
}

export const insert_other_item = async (electric: Electric, keys: [string]) => {
  const items = keys.map(k => {
    return {
      id: uuidv4(),
      content: k
    }
  })

  await electric.db.items.create({
    data: {
      id: "test_id_1",
      content: ""
    }
  })

  await electric.db.other_items.createMany({
    data: items
  })
}

export const delete_other_item = async (electric: Electric, keys: [string]) => {
  for (const key of keys) {
    await electric.db.other_items.deleteMany({
      where: {
        content: key
      }
    })
  }
}

export const stop = async () => {
  await globalRegistry.stopAll()
}
