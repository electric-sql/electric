import { Electric, schema } from '../generated/client'
import { uniqueTabId, genUUID } from 'electric-sql/util'
import { insecureAuthToken } from 'electric-sql/auth'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { environment } from '../environments/environment';
import { makeElectricContext } from '@electric-sql/angular';

const discriminator = 'linearlite'
const distPath = '/'

const DEV_MODE = environment.DEV
const ELECTRIC_URL = environment.ELECTRIC_URL
const DEBUG_ENV = environment.DEBUG

// We can override the debug mode with a query param: ?debug=true or ?debug=false
const searchParams = new URLSearchParams(window.location.search)
const debugParam = searchParams.get('debug')

// DEBUG defaults to true in dev mode, false in prod mode
export const DEBUG = debugParam ? debugParam === 'true' : DEV_MODE || DEBUG_ENV

// We export dbName so that we can delete the database if the schema changes
export let dbName: string


export const { provideElectric, injectElectric, ELECTRIC_CLIENT } = makeElectricContext<Electric>();

export async function initElectric() {
  const { tabId } = uniqueTabId()
  const electricUrl = ELECTRIC_URL ?? 'ws://localhost:5133'
  dbName = `${discriminator}-0.7.0-${tabId}.db`

  const config = {
    auth: {
      token: insecureAuthToken({ user_id: genUUID() }),
    },
    url: electricUrl,
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