import Database from 'better-sqlite3'
import jwt from 'jsonwebtoken'
import { ElectricConfig } from 'electric-sql'

import { setLogLevel } from 'electric-sql/debug'
import { electrify } from 'electric-sql/node'
import * as fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { dbSchema, Electric } from './generated/models'

setLogLevel('DEBUG')

function auth_token() {
  const jwtAlg: jwt.Algorithm =
    (process.env.SATELLITE_AUTH_JWT_ALG || 'HS256') as jwt.Algorithm
  const jwtKey =
    process.env.SATELLITE_AUTH_JWT_KEY ||
    'integration-tests-signing-key-example'

  const iat = Math.floor(Date.now() / 1000) - 1000

  return jwt.sign(
    { user_id: 'test-user', iat },
    jwtKey,
    {
      algorithm: jwtAlg,
      expiresIn: '2h',
    }
  )
}

export const read_migrations = (migration_file: string) => {
  const data = fs.readFileSync(migration_file)
  const json_data = JSON.parse(data.toString())
  return json_data.migrations
}

export const open_db = async (
  name: string,
  host: string,
  port: number,
  migrations: any
): Promise<Electric> => {
  const original = new Database(name)
  const config: ElectricConfig = {
    app: 'satellite_client',
    env: 'default',
    migrations: migrations,
    replication: {
      host: host,
      port: port,
      ssl: false,
    },
    debug: true,
  }
  console.log(`config: ${JSON.stringify(config)}`)
  return await electrify(original, dbSchema, config, {token: auth_token()})
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
