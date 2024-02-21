import { LIB_VERSION } from 'electric-sql/version'
import { makeElectricContext } from 'electric-sql/react'
import { uniqueTabId, genUUID } from 'electric-sql/util'
import { insecureAuthToken } from 'electric-sql/auth'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { Electric, schema } from './generated/client'
export type { Issue } from './generated/client'

export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

const discriminator = 'linearlite'

declare global {
  interface Window {
    // Tauir provides a global __TAURI__ object
    // we can use it to detect if we are running in a Tauri app
    __TAURI_INTERNALS__: any
  }
}

// import.meta.env is a special object that Vite provides for accessing
// environment variables at build time and runtime.
// They are replaced at build time with the actual values.
// https://vitejs.dev/guide/env-and-mode.html
const DEV_MODE = import.meta.env.DEV
const IS_TAURI = !!(
  import.meta.env.TAURI_PLATFORM || window.__TAURI_INTERNALS__
)
const ELECTRIC_SERVICE =
  import.meta.env.ELECTRIC_SERVICE || import.meta.env.ELECTRIC_URL
const DEBUG_ENV = import.meta.env.DEBUG

// We can override the debug mode with a query param: ?debug=true or ?debug=false
const searchParams = new URLSearchParams(window.location.search)
const debugParam = searchParams.get('debug')

// DEBUG defaults to true in dev mode, false in prod mode
export const DEBUG = debugParam ? debugParam === 'true' : DEV_MODE || DEBUG_ENV

// We export dbName so that we can delete the database if the schema changes
export let dbName: string

export const initElectric = async () => {
  const { tabId } = uniqueTabId()
  const electricUrl = ELECTRIC_SERVICE ?? 'ws://localhost:5133'
  dbName = IS_TAURI
    ? `${discriminator}.db`
    : `${discriminator}-${LIB_VERSION}-${tabId}.db`

  const config = {
    url: electricUrl,
    debug: DEBUG,
  }

  let userId = window.sessionStorage.getItem('userId')
  if (!userId) {
    userId = genUUID()
    window.sessionStorage.setItem('userId', userId)
  }
  const authToken = insecureAuthToken({ sub: userId })

  let electric

  const logDebug = (conn: any) => {
    if (DEBUG) {
      console.log('initElectric')
      console.log('dbName', dbName)
      console.log(conn)
      console.log(schema)
      console.log(config)
    }
  }

  if (IS_TAURI) {
    // We use dynamic imports to avoid importing tauri-electron in the browser
    let { createDatabase, electrify } = await import('electric-sql/tauri')
    const conn = await createDatabase(dbName)
    logDebug(conn)
    electric = await electrify(conn, schema, config)
  } else {
    const conn = await ElectricDatabase.init(dbName)
    logDebug(conn)
    electric = await electrify(conn, schema, config)
  }

  await electric.connect(authToken)
  return electric
}
