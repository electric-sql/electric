import React from "react"
import { getSerializedShape } from "@electric-sql/react"
import Home from "./Home"
import SSRShapesInitializer from "./ssr-shapes-provider"

const serverOptions = {
  url: new URL(`http://localhost:3000/v1/shape/items`).href,
}

const Page = async () => {
  const data = getSerializedShape(serverOptions)

  return (
    <SSRShapesInitializer serializedShapes={[{ data, serverOptions }]}>
      <Home />
    </SSRShapesInitializer>
  )
}

export default Page
