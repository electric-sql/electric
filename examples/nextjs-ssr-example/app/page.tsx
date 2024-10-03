import React from "react"
import { getSerializedShape } from "@electric-sql/react"
import Home from "./Home"
import { unstable_noStore as noStore } from "next/cache"

// Hack to avoid caching behavior in Next.js
// should work just with {cache: `no-store`}
const fetchClient: typeof fetch = (...args) => {
  const _url: URL =
    args[0] instanceof URL ? args[0] : new URL(args[0] as string)
  _url.searchParams.set(`_rand`, Math.random().toString())
  args[0] = _url
  return fetch(...args)
}

const itemShape = {
  url: new URL(`http://localhost:3000/v1/shape/items`).href,
  fetchClient,
}

const Page = async () => {
  noStore()

  return <Home shapes={{ items: getSerializedShape(itemShape) }} />
}

export default Page
