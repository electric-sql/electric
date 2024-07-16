import React, { createContext, useEffect, useContext, useState } from 'react'
import { Shape, ShapeStream, ShapeStreamOptions } from './client'
import { JsonSerializable } from './types'

interface ShapeContextType {
  getShape: (shapeStream: ShapeStream) => Shape
  getShapeStream: (options: ShapeStreamOptions) => ShapeStream
}

// Create a Context
const ShapesContext = createContext<ShapeContextType | null>(null)

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

interface ShapeProviderProps {
  children: React.ReactNode
}

// Shapes Provider Component
export function ShapesProvider({ children }: ShapeProviderProps): JSX.Element {
  // Provide the context value
  return (
    <ShapesContext.Provider value={{ getShape, getShapeStream }}>
      {children}
    </ShapesContext.Provider>
  )
}

export function useShapeContext() {
  const context = useContext(ShapesContext)
  if (!context) {
    throw new Error(`useShapeContext must be used within a ShapeProvider`)
  }
  return context
}

export function useShape<Data extends JsonSerializable>(
  options: ShapeStreamOptions
) {
  const { getShape, getShapeStream } = useShapeContext()
  const shapeStream = getShapeStream(options)
  const shape = getShape(shapeStream)
  const [shapeData, setShapeData] = useState<Data[]>([
    ...shape.valueSync.values(),
  ] as Data[])

  useEffect(() => {
    // Subscribe to updates.
    const unsubscribe = shape.subscribe((map) => {
      setShapeData([...map.values()] as Data[])
    })

    return () => {
      unsubscribe()
    }
  }, [])

  return shapeData
}
