import React from "react"
import { getSerializedShape } from "@electric-sql/react"
import Home from "./Home"

const serverShapeOptions = {
  url: new URL(`http://localhost:3000/v1/shape/items`).href,
}

const Page = async () => {
  return <Home shapes={{ items: getSerializedShape(serverShapeOptions) }} />
}

export default Page
