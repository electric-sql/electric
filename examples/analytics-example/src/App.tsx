import logo from "./assets/logo.svg"
import { useEffect, useState } from "react"
import { PGlite } from "@electric-sql/pglite"
import { live, PGliteWithLive } from "@electric-sql/pglite/live"
import { electricSync } from "@electric-sql/pglite-sync"
import { PGliteProvider } from "@electric-sql/pglite-react"
import {
  createListingsTableSql,
  listingsPrimaryKey,
  listingsTableName,
} from "./table"

import "./App.css"
import "./style.css"

import { Example } from "./Example"

let initialised = false
let unsub = () => {}

export default function App() {
  const [db, setDb] = useState<PGliteWithLive | undefined>(undefined)
  useEffect(() => {
    const initDb = async () => {
      if (initialised) return
      initialised = true
      // Initialize PGlite with extensions
      const db = await PGlite.create({
        dataDir: `idb://analytics-example`,
        extensions: { live, electric: electricSync() },
      })

      // Create local tables to sync data into
      await db.exec(createListingsTableSql)
      await db.exec(`TRUNCATE ${listingsTableName}`)

      const shape = await db.electric.syncShapeToTable({
        url: `http://localhost:3000/v1/shape/${listingsTableName}`,
        table: listingsTableName,
        primaryKey: [listingsPrimaryKey],
      })

      setDb(db)
      unsub = () => shape.unsubscribe()
    }

    const initPromise = initDb()

    return () => {
      initPromise.then(() => unsub())
    }
  }, [])
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        {db !== undefined ? (
          <PGliteProvider db={db}>
            <Example />
          </PGliteProvider>
        ) : (
          <div />
        )}
      </header>
    </div>
  )
}
