import React, { createContext, useEffect, useContext, useState } from 'react'

// Create a Context
const ShapesContext = createContext({
  getShape: (options: ShapeStreamOptions): Shape => {
    throw new Error(`ShapesContext not initialized`)
  },
})

const cache = new Map()

export async function preloadShape(
  options: ShapeStreamOptions
): Promise<Shape> {
  const shape = getShape(options)
  await shape.value
  return shape
}

export function getShape(options: ShapeStreamOptions): Shape {
  // A somewhat hacky way to cheaply create a consistent hash of the shape options.
  const shapeDef = JSON.stringify(
    options.shape,
    Object.keys(options.shape).sort()
  )
  const allOptions = JSON.stringify(options, Object.keys(options).sort())
  const shapeHash = shapeDef + allOptions

  // If the shape is already cached
  if (cache.has(shapeHash)) {
    // Return the cached shape
    return cache.get(shapeHash)
  } else {
    const newShape = new Shape(options)

    cache.set(shapeHash, newShape)

    // Return the created shape
    return newShape
  }
}

// Shapes Provider Component
export function ShapesProvider({ children }) {
  // Provide the context value
  return (
    <ShapesContext.Provider value={{ getShape }}>
      {children}
    </ShapesContext.Provider>
  )
}

import { Shape, ShapeStreamOptions } from './client'

export function useShape(options: ShapeStreamOptions) {
  const { getShape } = useContext(ShapesContext)
  const shape = getShape(options)
  const [shapeData, setShapeData] = useState<unknown[]>([
    ...shape.value.values(),
  ])

  useEffect(() => {
    // Subscribe to updates.
    const unsubscribe = shape.subscribe((map) => {
      setShapeData([...map.values()])
    })

    return () => {
      unsubscribe()
    }
  }, [])

  return shapeData
}
