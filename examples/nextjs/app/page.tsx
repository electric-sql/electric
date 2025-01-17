import { preloadShape } from "@electric-sql/react"
import { itemShapeOptions } from "./items"
import { ItemsList } from "./items-list"
import "./Example.css"

export default async function Page() {
  // Preload shape data during SSR
  await preloadShape(itemShapeOptions)

  return <ItemsList />
}
