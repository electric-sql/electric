import { LIB_VERSION } from 'electric-sql/version'
import { makeElectricContext } from 'electric-sql/react'
import { uniqueTabId, genUUID } from 'electric-sql/util'
import { insecureAuthToken } from 'electric-sql/auth'
import { Electric, schema } from './generated/client'
export type { Issue } from './generated/client'

export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

// import.meta.env is a special object that Vite provides for accessing
// environment variables at build time and runtime.
// They are replaced at build time with the actual values.
// https://vitejs.dev/guide/env-and-mode.html
const DEV_MODE = import.meta.env.DEV
const ELECTRIC_SERVICE =
  import.meta.env.ELECTRIC_SERVICE || import.meta.env.ELECTRIC_URL
const DEBUG_ENV = import.meta.env.DEBUG
const CLIENT_DB: 'wa-sqlite' | 'pglite' =
  import.meta.env.ELECTRIC_CLIENT_DB || 'wa-sqlite'

const discriminator = 'linearlite'
const tabId = uniqueTabId().tabId.slice(0, 8)
const electricUrl = ELECTRIC_SERVICE ?? 'ws://localhost:5133'

// We can override the debug mode with a query param: ?debug=true or ?debug=false
const searchParams = new URLSearchParams(window.location.search)
const debugParam = searchParams.get('debug')

// DEBUG defaults to true in dev mode, false in prod mode
export const DEBUG = debugParam ? debugParam === 'true' : DEV_MODE || DEBUG_ENV

// We export dbName so that we can delete the database if the schema changes
export let dbName: string

const initPGlite = async () => {
  const { electrify } = await import('electric-sql/pglite')
  const { PGlite } = await import('@electric-sql/pglite')

  dbName = `idb://${discriminator}-${LIB_VERSION}-${tabId}.db`

  const config = {
    url: electricUrl,
    debug: DEBUG,
  }

  const conn = new PGlite(dbName)
  const electric = await electrify(conn, schema, config)
  return {
    electric,
    conn,
    config,
  }
}

export const initWaSqlite = async () => {
  const { electrify, ElectricDatabase } = await import('electric-sql/wa-sqlite')

  dbName = `${discriminator}-${LIB_VERSION}-${tabId}.db`
  console.log('dbName', dbName)

  const config = {
    url: electricUrl,
    debug: DEBUG,
  }

  const conn = await ElectricDatabase.init(dbName)
  const electric = await electrify(conn, schema, config)
  return {
    electric,
    conn,
    config,
  }
}

export const initElectric = async () => {
  const { electric, conn, config } =
    CLIENT_DB === 'wa-sqlite' ? await initWaSqlite() : await initPGlite()

  if (DEBUG) {
    console.log('initElectric')
    console.log('dbName', dbName)
    console.log(conn)
    console.log(schema)
    console.log(config)

    const { addToolbar } = await import('@electric-sql/debug-toolbar')
    addToolbar(electric)
  }
  await electric.adapter.run({
    sql: 'PRAGMA foreign_keys=OFF;',
  })

  let userId = window.sessionStorage.getItem('userId')
  if (!userId) {
    userId = genUUID()
    window.sessionStorage.setItem('userId', userId)
  }
  const authToken = insecureAuthToken({ sub: 'user3' })

  await electric.connect(authToken)
  return electric
}
