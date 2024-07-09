import React, { createContext, useEffect, useContext, useState } from 'react'

// Create a Context
const ShapesContext = createContext({
  getShape: (_options) => {
    throw new Error(`ShapesContext not initialized`)
  },
})

// Shapes Provider Component
export function ShapesProvider({ children }) {
  const [cache, setCache] = useState({}) // Initialize an empty cache

  const getShape = (options) => {
    // A somewhat hacky way to cheaply create a consistent hash of the shape options.
    const shapeDef = JSON.stringify(
      options.shape,
      Object.keys(options.shape).sort()
    )
    const allOptions = JSON.stringify(options, Object.keys(options).sort())
    const shapeHash = shapeDef + allOptions

    // If the shape is already cached
    if (cache[shapeHash]) {
      // Return the cached shape
      return cache[shapeHash]
    } else {
      const newShape = new Shape(options)

      setCache((prevCache) => ({
        // Add it to the cache
        ...prevCache,
        [shapeHash]: newShape,
      }))

      // Return the created shape
      return newShape
    }
  }

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
  const shape = getShape(options) as Shape
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
