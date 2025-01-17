import { preloadShape } from "@electric-sql/react"
import { ShapeStreamOptions } from "@electric-sql/client"

// Server-side shape configuration
export const itemShapeOptions: ShapeStreamOptions = {
  url: process.env.ELECTRIC_URL || `http://localhost:5173/shape-proxy`,
  params: {
    table: `items`,
  },
}

// Client-side shape configuration
export const getClientShapeOptions = (): ShapeStreamOptions => {
  return {
    ...itemShapeOptions,
    url: `http://localhost:5173/shape-proxy`,
  }
}

// Server component to prefetch shape data
export async function ItemsData() {
  // Prefetch shape data during SSR
  await preloadShape(itemShapeOptions)
  return null
}
