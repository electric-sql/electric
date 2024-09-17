import logo from "./assets/logo.svg"
import { PGlite } from "@electric-sql/pglite"
import { live } from "@electric-sql/pglite/live"
import { electricSync } from "@electric-sql/pglite-sync"
import { PGliteProvider } from "@electric-sql/pglite-react"

import "./App.css"
import "./style.css"

import { Example } from "./Example"
import { useEffect } from "react"

// Initialize PGlite with extensions
const db = await PGlite.create({
  extensions: { live, electric: electricSync() },
})

const tableName = `airbnb_listings`

// Create local tables to sync data into
await db.exec(`
  CREATE TABLE ${tableName} (
    listing_id INT PRIMARY KEY,
    name TEXT,
    host_id INT,
    host_since DATE,
    host_location TEXT,
    host_response_time TEXT,
    host_response_rate DECIMAL(3, 2),
    host_acceptance_rate DECIMAL(3, 2),
    host_is_superhost BOOLEAN,
    host_total_listings_count INT,
    host_has_profile_pic BOOLEAN,
    host_identity_verified BOOLEAN,
    neighbourhood TEXT,
    district TEXT,
    city TEXT,
    latitude DECIMAL(8, 5),
    longitude DECIMAL(8, 5),
    property_type TEXT,
    room_type TEXT,
    accommodates INT,
    bedrooms INT,
    amenities TEXT[],
    price DECIMAL(10, 2),
    minimum_nights INT,
    maximum_nights INT,
    review_scores_rating INT,
    review_scores_accuracy INT,
    review_scores_cleanliness INT,
    review_scores_checkin INT,
    review_scores_communication INT,
    review_scores_location INT,
    review_scores_value INT,
    instant_bookable BOOLEAN
  );
`)

export default function App() {
  useEffect(() => {
    db.electric.syncShapeToTable({
      url: `http://localhost:3000/v1/shape/${tableName}`,
      table: tableName,
      primaryKey: ["id"],
    })
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
