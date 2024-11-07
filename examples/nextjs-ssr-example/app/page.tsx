import React from "react"
import Home from "./Home"
import ServerShapeProvider from "./server-shape-provider"
import { ShapeDefintion } from "./utils"

const itemsShape: ShapeDefintion = {
  table: `items`,
}

const Page = async () => (
  <ServerShapeProvider options={[itemsShape]}>
    <Home />
  </ServerShapeProvider>
)

export default Page
