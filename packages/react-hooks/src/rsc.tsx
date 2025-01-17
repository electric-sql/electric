import {
  Row,
  ShapeStreamOptions,
  GetExtensions,
} from '@electric-sql/client'
import { ShapeClient, SSRState, sortedOptionsHash, isSSR } from './core'

// Cache ShapeClient per request
let clientCache: ShapeClient | undefined

// Get or create the ShapeClient instance for this request
export function getShapeClient(): ShapeClient {
  if (!isSSR) {
    throw new Error('getShapeClient should only be called on the server')
  }
  
  if (!clientCache) {
    clientCache = new ShapeClient()
  }
  return clientCache
}

// This is the main function that will be used in Server Components
export async function prefetchShape<T extends Row<unknown>>(
  options: ShapeStreamOptions<GetExtensions<T>>
): Promise<void> {
  const shapeClient = getShapeClient()
  const optionsHash = sortedOptionsHash(options)
  
  const shapeStream = shapeClient.getShapeStream(options, optionsHash)
  const shape = shapeClient.getShape(shapeStream)

  // Wait for initial data
  await shape.value

  // Store the dehydrated state
  shapeClient.setDehydratedState(optionsHash, {
    rows: Array.from(shape.currentValue.entries()),
    lastSyncedAt: shape.lastSyncedAt(),
    // These properties are internal to ShapeStream and not exposed in types
    offset: (shapeStream as any).offset,
    handle: (shapeStream as any).handle,
  })
}

// Re-export the HydrationBoundary type for convenience
export type { HydrationBoundaryProps } from './hydration'
