import { getShapeClient, prefetchShape } from "@electric-sql/react/rsc"
import { HydrationBoundary } from "@electric-sql/react/hydration"
import { itemShapeOptions } from "./items"
import { ItemsList } from "./items-list"
import "./Example.css"

export default async function Page() {
  const shapeClient = getShapeClient()

  // Prefetch shape data during SSR
  await prefetchShape(itemShapeOptions)

  return (
    <HydrationBoundary state={shapeClient.getDehydratedState()}>
      <ItemsList />
    </HydrationBoundary>
  )
}
