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

export const get_tables = async (electric: Electric) => {
  return electric.db.raw({ sql: `SELECT name FROM sqlite_master WHERE type='table';` })
}

export const get_columns = async (electric: Electric, table: string) => {
  return electric.db.raw({ sql: `SELECT * FROM pragma_table_info(?);`, args: [table] })
}

export const get_rows = async (electric: Electric, table: string) => {
  return await electric.db.raw({sql: `SELECT * FROM ${table};`})
}

export const get_items = async (electric: Electric) => {
  return await electric.db.items.findMany({})
}

export const get_item_ids = async (electric: Electric) => {
  return await electric.db.items.findMany({
    select: {
      id: true
    }
  })
}

export const get_item_columns = async (electric: Electric, table: string, column: string) => {
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

export const get_other_items = async (electric: Electric) => {
  return await electric.db.other_items.findMany({})
}

export const insert_other_item = async (electric: Electric, keys: [string]) => {
  const items = keys.map(k => {
    return {
      id: uuidv4(),
      content: k
    }
  })

  electric.db.items.create({
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
