import { Row, ShapeStreamOptions } from '@electric-sql/client'
import React, { createContext, useContext } from 'react'
import { ShapeClient, SSRState, sortedOptionsHash } from './core'
import { isSSR } from './core'

// Track SSR shape streams
let ssrClient: ShapeClient | undefined
const ssrShapes = new Map<string, SSRState>()

// Create a context for SSR shape streams
const ShapesContext = createContext<Map<string, SSRState> | undefined>(undefined)

export function useShapes() {
  return useContext(ShapesContext)
}

export function useShapeStream<SourceData extends Row<unknown>>(
  options: ShapeStreamOptions<unknown>
) {
  if (!isSSR) return undefined

  if (!ssrClient) {
    throw new Error('SSR client not initialized')
  }

  const optionsHash = sortedOptionsHash(options)
  const shapeStream = ssrClient.getShapeStream(options, optionsHash)
  const shape = ssrClient.getShape(shapeStream)

  return shape
}

export function serializeSSRState(shapes: Map<string, SSRState>): string {
  const state: Record<string, SSRState> = {}
  for (const [key, value] of shapes) {
    state[key] = value
  }

  return JSON.stringify(state)
}

export function ElectricScripts() {
  const shapes = useShapes()
  if (!shapes) return null

  return (
    <script
      id="__ELECTRIC_SSR_STATE__"
      type="application/json"
      dangerouslySetInnerHTML={{
        __html: serializeSSRState(shapes),
      }}
    />
  )
}

export function ElectricProvider({ children }: { children: React.ReactNode }) {
  // Initialize SSR client if needed
  if (isSSR && !ssrClient) {
    ssrClient = new ShapeClient()
  }

  return (
    <ShapesContext.Provider value={ssrShapes}>
      {children}
    </ShapesContext.Provider>
  )
}
