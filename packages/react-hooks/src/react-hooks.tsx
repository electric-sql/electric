import React, {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  useRef,
} from 'react'
import {
  Shape,
  ShapeStream,
  ShapeStreamOptions,
  JsonSerializable,
} from '@electric-sql/next'

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

export function sortedOptionsHash(options: ShapeStreamOptions): string {
  const shapeDef = JSON.stringify(
    options.shape,
    Object.keys(options.shape).sort()
  )
  // eslint-disable-next-line
  const { shape, ...optionsWithoutShapeDef } = options
  const allOptions = JSON.stringify(
    optionsWithoutShapeDef,
    Object.keys(options).sort()
  )
  const shapeHash = shapeDef + allOptions

  return shapeHash
}

export function getShapeStream(options: ShapeStreamOptions): ShapeStream {
  const shapeHash = sortedOptionsHash(options)

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

interface UseShapeResult {
  /**
   * The array of rows that make up the Shape.
   * @type {JsonSerializable}
   */
  data: JsonSerializable[]
  /**
   * The Shape instance used by this useShape
   * @type(Shape)
   */
  shape: Shape
  error: Shape[`error`]
  isError: boolean
  /**
   * Has the ShapeStream caught up with the replication log from Postgres.
   */
  isUpToDate: boolean
}

function shapeSubscribe(shape: Shape, callback: () => void) {
  const unsubscribe = shape.subscribe(callback)
  return () => {
    unsubscribe()
  }
}

function parseShapeData(shape: Shape): UseShapeResult {
  return {
    data: [...shape.valueSync.values()],
    isUpToDate: shape.isUpToDate,
    isError: shape.error !== false,
    shape,
    error: shape.error,
  }
}

export function useShape(options: ShapeStreamOptions): UseShapeResult {
  const { getShape, getShapeStream } = useShapeContext()
  const shapeStream = getShapeStream(options)
  const shape = getShape(shapeStream)

  const latestShapeData = useRef(parseShapeData(shape))
  const getSnapshot = React.useCallback(() => latestShapeData.current, [])
  const shapeData = useSyncExternalStore(
    useCallback(
      (onStoreChange) =>
        shapeSubscribe(shape, () => {
          latestShapeData.current = parseShapeData(shape)
          onStoreChange()
        }),
      [shape]
    ),
    getSnapshot,
    getSnapshot
  )

  return shapeData
}
