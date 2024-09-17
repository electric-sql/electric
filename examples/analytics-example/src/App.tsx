import logo from "./assets/logo.svg"
import { useEffect } from "react"
import { PGlite } from "@electric-sql/pglite"
import { live } from "@electric-sql/pglite/live"
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

// Initialize PGlite with extensions
const db = await PGlite.create({
  dataDir: `memory://`,
  extensions: { live, electric: electricSync() },
})

// Create local tables to sync data into
await db.exec(createListingsTableSql)

export default function App() {
  useEffect(() => {
    const shapePromise = db.electric.syncShapeToTable({
      url: `http://localhost:3000/v1/shape/${listingsTableName}`,
      table: listingsTableName,
      primaryKey: [listingsPrimaryKey],
    })

    return () => {
      shapePromise.then((shape) => shape.unsubscribe())
    }
  }, [])
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <PGliteProvider db={db}>
          <Example />
        </PGliteProvider>
      </header>
    </div>
  )
}
