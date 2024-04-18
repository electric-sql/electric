import { makeElectricContext } from 'electric-sql/react'
import { LIB_VERSION } from 'electric-sql/version'
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'
import { uniqueTabId } from 'electric-sql/util'
import { userId } from './auth'
import { ELECTRIC_URL, debugMode } from './config'
import { Electric, schema } from './generated/client'
import { insecureAuthToken } from 'electric-sql/auth'

export type {
  Electric,
  Demos as Demo,
  Items as Item,
  Players as Player,
  Sliders as Slider,
  Tournaments as Tournament,
} from './generated/client'

export type DB = Electric['db']

export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export const initElectric = async (name: string = 'intro') => {
  const { tabId } = uniqueTabId()
  const scopedDbName = `${name}-${LIB_VERSION}-${tabId}.db`

  const conn = await ElectricDatabase.init(scopedDbName)
  const config = {
    url: ELECTRIC_URL,
    debug: debugMode(),
  }

  const client = await electrify(conn, schema, config)

  await client.connect(insecureAuthToken({ sub: userId() }))
  const { db } = client

  await db.unsafeExec({ sql: 'PRAGMA foreign_keys = 1' })
  await db.unsafeExec({
    sql: `UPDATE main._electric_meta set value = ? where key = ?`,
    args: [1, 'compensations'],
  })

  return client
}
