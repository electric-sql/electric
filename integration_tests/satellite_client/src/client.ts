import Database from 'better-sqlite3'
import jwt from 'jsonwebtoken'
import { ElectricConfig } from 'electric-sql'
import { ConsoleClient, TokenRequest } from 'electric-sql/dist/satellite'

import { setLogLevel } from 'electric-sql/debug'
import { electrify, ElectrifiedDatabase } from 'electric-sql/node'
import * as fs from 'fs'
import { v4 as uuidv4 } from 'uuid'

setLogLevel('DEBUG')

// Console client throws an error when unable to fetch token which causes test to fail
export class MockConsoleClient implements ConsoleClient {
  token = async (request: TokenRequest) => {
    const mockIss =
      process.env.SATELLITE_AUTH_SIGNING_ISS || 'dev.electric-sql.com'
    const mockKey =
      process.env.SATELLITE_AUTH_SIGNING_KEY ||
      'integration-tests-signing-key-example'

    const iat = Math.floor(Date.now() / 1000) - 1000

    const token = jwt.sign(
      { user_id: request.clientId, type: 'access', iat },
      mockKey,
      {
        issuer: mockIss,
        algorithm: 'HS256',
        expiresIn: '2h',
      }
    )

    // Refresh token is not going to be used, so we don't mock it
    return { token, refreshToken: '' }
  }
}

export const read_migrations = (migration_file: string) => {
  const data = fs.readFileSync(migration_file)
  const json_data = JSON.parse(data.toString())
  return json_data.migrations
}

export const open_db = (
  name: string,
  host: string,
  port: number,
  migrations: any
): Promise<ElectrifiedDatabase> => {
  //= () => Promise<ElectrifiedDatabase> {
  const original = new Database(name)
  const config: ElectricConfig = {
    app: 'satellite_client',
    migrations: migrations,
    replication: {
      host: host,
      port: port,
      ssl: false,
    },
    debug: true,
  }
  console.log(`config: ${JSON.stringify(config)}`)
  return electrify(original, config, {
    console: new MockConsoleClient(),
  })
}

export const set_subscribers = (db: ElectrifiedDatabase) => {
  db.electric.notifier.subscribeToAuthStateChanges((x) => {
    console.log('auth state changes: ')
    console.log(x)
  })
  db.electric.notifier.subscribeToPotentialDataChanges((x) => {
    console.log('potential data change: ')
    console.log(x)
  })
  db.electric.notifier.subscribeToDataChanges((x) => {
    console.log('data changes: ')
    console.log(JSON.stringify(x))
  })
}

export const get_items = (db: ElectrifiedDatabase) => {
  const stmt = db.prepare('SELECT * FROM main.items;')
  return stmt.all()
}

export const insert_item = (db: ElectrifiedDatabase, keys: [string]) => {
  const st = db.prepare<{ uuid: string; key: string }>(
    'INSERT INTO main.items (id, content) VALUES ( @uuid, @key )'
  )
  for (var key of keys) {
    let myuuid = uuidv4()
    st.run({ key: key, uuid: myuuid })
  }
}

export const delete_item = (db: ElectrifiedDatabase, keys: [string]) => {
  const st = db.prepare<[string]>('DELETE FROM main.items WHERE content = ?')
  for (var key of keys) {
    st.run(key)
  }
}

export const get_other_items = (db: ElectrifiedDatabase) => {
  const stmt = db.prepare('SELECT * FROM main.other_items;')
  return stmt.all()
}

export const insert_other_item = (db: ElectrifiedDatabase, keys: [string]) => {
  const st = db.prepare<{ uuid: string; key: string }>(
    'INSERT INTO main.other_items (id, content) VALUES ( @uuid, @key )'
  )
  for (var key of keys) {
    let myuuid = uuidv4()
    st.run({ key: key, uuid: myuuid })
  }
}

export const delete_other_item = (db: ElectrifiedDatabase, keys: [string]) => {
  const st = db.prepare<[string]>(
    'DELETE FROM main.other_items WHERE content = ?'
  )
  for (var key of keys) {
    st.run(key)
  }
}

export const run = (db: ElectrifiedDatabase) => {
  const stmt = db.prepare('select 1')
  return db.transaction(() => {
    stmt.run()
  })
}
