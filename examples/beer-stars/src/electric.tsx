import { makeElectricContext } from 'electric-sql/react'
import { uniqueTabId } from 'electric-sql/util'
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'

import { authToken } from './auth'
import { DEBUG_MODE, ELECTRIC_URL } from './config'
import { Electric, schema } from './generated/client/index'

export type {
  Electric,
  Beers as Beer,
  Stars as Star,
} from './generated/client/index'
export type DB = Electric['db']
export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export const initElectric = async (name: string = 'beer-stars') => {
  const tabId = uniqueTabId()
  const tabScopedDbName = `${name}-${tabId}.db`
  const conn = await ElectricDatabase.init(tabScopedDbName, '/')

  const config = {
    auth: {
      token: authToken()
    },
    url: ELECTRIC_URL,
    debug: DEBUG_MODE
  }

  const electric = await electrify(conn, schema, config)
  const { db } = electric

  await db.raw({sql: 'PRAGMA foreign_keys = 1'})
  await db.raw({
    sql: `UPDATE main._electric_meta set value = ? where key = ?`,
    args: [1, "compensations"],
  });

  return electric
}
