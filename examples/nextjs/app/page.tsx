import { ItemsList } from "./items-list"
import type { Item } from "./types"
import { preloadShape } from "@electric-sql/react"
import { itemShapeOptions } from "./items"

export default async function Page() {
  await preloadShape<Item>(itemShapeOptions)

  return <ItemsList />
}
