import { ItemsList } from "./items-list"
import type { Item } from "./types"
import { preloadShape, serializeShape } from "@electric-sql/react"
import { itemShapeOptions } from "./items"

export default async function Page() {
  const shape = await preloadShape<Item>(itemShapeOptions)

  return <ItemsList initialShape={serializeShape(shape)} />
}
