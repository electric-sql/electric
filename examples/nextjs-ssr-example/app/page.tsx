import React from "react"
import { getShapeData } from "./shape"
import Home from "./Home"
import { unstable_noStore as noStore } from "next/cache"

const Page = async () => {
  noStore()
  return <Home shape={getShapeData()} />
}

export default Page
