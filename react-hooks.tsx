import React, { createContext, useEffect, useContext, useState } from 'react'
import { Shape, ShapeStream, ShapeStreamOptions } from './client'

// Create a Context
const ShapesContext = createContext({
  getShape: (stream: ShapeStream): Shape => {
    console.log({ stream })
    throw new Error(`ShapesContext not initialized`)
  },
  getShapeStream: (options: ShapeStreamOptions): ShapeStream => {
    console.log({ options })
    throw new Error(`ShapesContext not initialized`)
  },
})

const streamCache = new Map<string, ShapeStream>()
const shapeCache = new Map<ShapeStream, Shape>()

export async function preloadShape(
  options: ShapeStreamOptions
): Promise<Shape> {
  const shapeStream = getShapeStream(options)
  const shape = getShape(shapeStream)
  await shape.value
  return shape
}

export function getShapeStream(options: ShapeStreamOptions): ShapeStream {
  // A somewhat hacky way to cheaply create a consistent hash of the shape options.
  const shapeDef = JSON.stringify(
    options.shape,
    Object.keys(options.shape).sort()
  )
  const allOptions = JSON.stringify(options, Object.keys(options).sort())
  const shapeHash = shapeDef + allOptions
  // If the stream is already cached, return
  if (streamCache.has(shapeHash)) {
    // Return the ShapeStream
    return streamCache.get(shapeHash)!
  } else {
    const newShapeStream = new ShapeStream(options)

    streamCache.set(shapeHash, newShapeStream)

    // Return the created shape
    return newShapeStream
  }
}

export function getShape(shapeStream: ShapeStream): Shape {
  // If the stream is already cached, return
  if (shapeCache.has(shapeStream)) {
    // Return the ShapeStream
    return shapeCache.get(shapeStream)!
  } else {
    const newShape = new Shape(shapeStream)

    shapeCache.set(shapeStream, newShape)

    // Return the created shape
    return newShape
  }
}

// Shapes Provider Component
export function ShapesProvider({ children }) {
  // Provide the context value
  return (
    <ShapesContext.Provider value={{ getShape, getShapeStream }}>
      {children}
    </ShapesContext.Provider>
  )
}

export function useShape(options: ShapeStreamOptions) {
  const { getShape, getShapeStream } = useContext(ShapesContext)
  const shapeStream = getShapeStream(options)
  const shape = getShape(shapeStream)
  const [shapeData, setShapeData] = useState<unknown[]>([
    ...shape.valueSync.values(),
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
