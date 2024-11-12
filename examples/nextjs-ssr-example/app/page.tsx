import React from "react"
import Home from "./Home"
import ServerShapeProvider from "./server-shape-provider"
import { SerializedShapeOptions } from "./utils"

const itemsShape: SerializedShapeOptions = {
  table: `items`,
}

const Page = async () => (
  // Passes a shape fetched on server to client
  // and loads it into clients shape cache
  <ServerShapeProvider options={[itemsShape]}>
    <Home />
  </ServerShapeProvider>
)

export default Page
