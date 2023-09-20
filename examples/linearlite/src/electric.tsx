import { version } from 'electric-sql/package.json'
import { makeElectricContext } from 'electric-sql/react'
import { uniqueTabId } from 'electric-sql/util'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { Electric, schema } from './generated/client'
export type { Issue } from './generated/client'

export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

const discriminator = 'linearlite'
const distPath = '/'

const searchParams = new URLSearchParams(window.location.search)
export const DEBUG = searchParams.get('debug') === 'true'

export let dbName: string

export const initElectric = async () => {
  const { tabId } = uniqueTabId()
  dbName = `${discriminator}-${version}-${tabId}.db`

  const config = {
    auth: {
      token:
        'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJsb2NhbC1kZXZlbG9wbWVudCIsInR5cGUiOiJhY2Nlc3MiLCJ1c2VyX2lkIjoidGVzdC11c2VyIiwiaWF0IjoxNjg3ODc3OTQ1LCJleHAiOjE2OTc4ODE1NDV9.L5Ui2sA9o5MeYDuy67u9lBV-2FzpOWL9dKcitRvgorg',
    },
    debug: DEBUG,
  }

  const conn = await ElectricDatabase.init(dbName, distPath)
  if (DEBUG) {
    console.log('initElectric')
    console.log('dbName', dbName)
    console.log(conn)
    console.log(schema)
    console.log(config)
  }
  return await electrify(conn, schema, config)
}
