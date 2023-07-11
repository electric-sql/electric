import Database from 'better-sqlite3'
import { ElectricConfig } from 'electric-sql'
import { authToken } from 'electric-sql/auth'

import { setLogLevel } from 'electric-sql/debug'
import { electrify } from 'electric-sql/node'
import { v4 as uuidv4 } from 'uuid'
import { schema, Electric } from './generated/models'

setLogLevel('DEBUG')

export const open_db = async (
  name: string,
  host: string,
  port: number,
  migrations: any
): Promise<Electric> => {
  const original = new Database(name)
  const config: ElectricConfig = {
    url: `electric://${host}:${port}`,
    debug: true,
    auth: {
      token: authToken(process.env.SATELLITE_AUTH_SIGNING_ISS, process.env.SATELLITE_AUTH_SIGNING_KEY)
    }
  }
  console.log(`config: ${JSON.stringify(config)}`)
  schema.migrations = migrations
  return await electrify(original, schema, config)
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

export const syncTable = async (electric: Electric, table: 'items' | 'other_items') => {
  const {dataReceived} = await electric.db[table].sync()
  return await dataReceived
}

export const get_tables = async (electric: Electric) => {
  return electric.db.raw({ sql: `SELECT name FROM sqlite_master WHERE type='table';` })
}

export const get_columns = async (electric: Electric, table: string) => {
  return electric.db.raw({ sql: `SELECT * FROM pragma_table_info(?);`, args: [table] })
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
  const fixedColumns = { 'id': uuidv4 }
  const columns = Object.keys(fixedColumns).concat(Object.keys(values))
  const columnNames = columns.join(", ")
  const placeHolders = Array(columns.length).fill("?")
  const args = Object.values(fixedColumns).map(f => f()).concat(Object.values(values))

  await electric.db.raw({
    sql: `INSERT INTO items (${columnNames}) VALUES (${placeHolders}) RETURNING *;`,
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
