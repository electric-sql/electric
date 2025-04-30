import {
  GetExtensions,
  Row,
  Shape,
  ShapeStream,
  ShapeStreamOptions,
} from '@electric-sql/client'
import { onUnmounted, reactive } from 'vue'

type UnknownShape = Shape<Row<unknown>>
type UnknownShapeStream = ShapeStream<Row<unknown>>

const streamCache = new Map<string, UnknownShapeStream>()
const shapeCache = new Map<UnknownShapeStream, UnknownShape>()

export async function preloadShape<T extends Row<unknown> = Row>(
  options: ShapeStreamOptions<GetExtensions<T>>
): Promise<Shape<T>> {
  const shapeStream = getShapeStream<T>(options)
  const shape = getShape<T>(shapeStream)
  await shape.rows
  return shape
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sortObjectKeys(obj: any): any {
  if (typeof obj !== `object` || obj === null) return obj

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys)
  }

  return (
    Object.keys(obj)
      .sort()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce<Record<string, any>>((sorted, key) => {
        sorted[key] = sortObjectKeys(obj[key])
        return sorted
      }, {})
  )
}

export function sortedOptionsHash<T>(options: ShapeStreamOptions<T>): string {
  return JSON.stringify(sortObjectKeys(options))
}

export function getShapeStream<T extends Row<unknown>>(
  options: ShapeStreamOptions<GetExtensions<T>>
): ShapeStream<T> {
  const shapeHash = sortedOptionsHash(options)

  // If the stream is already cached, return it if valid
  if (streamCache.has(shapeHash)) {
    const stream = streamCache.get(shapeHash)! as ShapeStream<T>
    if (!stream.options.signal?.aborted) {
      return stream
    }

    // if stream is aborted, remove it and related shapes
    streamCache.delete(shapeHash)
    shapeCache.delete(stream)
  }

  const newShapeStream = new ShapeStream<T>(options)
  streamCache.set(shapeHash, newShapeStream)

  return newShapeStream
}

export function getShape<T extends Row<unknown>>(
  shapeStream: ShapeStream<T>
): Shape<T> {
  // If the stream is already cached, return it if valid
  if (shapeCache.has(shapeStream)) {
    if (!shapeStream.options.signal?.aborted) {
      return shapeCache.get(shapeStream)! as Shape<T>
    }

    // if stream is aborted, remove it and related shapes
    streamCache.delete(sortedOptionsHash(shapeStream.options))
    shapeCache.delete(shapeStream)
  }

  const newShape = new Shape<T>(shapeStream)
  shapeCache.set(shapeStream, newShape)

  return newShape
}

export interface UseShapeOptions<T extends Row<unknown> = Row>
  extends ShapeStreamOptions<GetExtensions<T>> {}

export interface UseShapeResult<T extends Row<unknown> = Row> {
  /**
   * Array of rows that make up the Shape.
   * @type {T[]}
   */
  data: T[]
  /**
   * The Shape instance used by this useShape
   * @type {Shape<T>}
   */
  shape: Shape<T>
  /**
   * The ShapeStream instance used by this Shape
   * @type {ShapeStream<T>}
   */
  stream: ShapeStream<T>
  /**
   * Loading state. True during initial fetch. False afterwise.
   * @type {boolean}
   */
  isLoading: boolean
  /**
   * Unix time at which we last synced. Undefined when `isLoading` is true.
   * @type {number | undefined}
   */
  lastSyncedAt: number | undefined
  /**
   * The error state of the Shape
   * @type {Shape<T>['error']}
   */
  error: Shape<T>[`error`]
  /**
   * Indicates if there is an error
   * @type {boolean}
   */
  isError: boolean
}

/**
 * Vue composable for using ElectricSQL shapes
 */
export function useShape<T extends Row<unknown> = Row>(
  options: UseShapeOptions<T>
): UseShapeResult<T> {
  const shapeStream = getShapeStream<T>(options)
  const shape = getShape<T>(shapeStream)

  const result = reactive<UseShapeResult<T>>({
    data: shape.currentRows,
    isLoading: true, // Start with loading true
    lastSyncedAt: undefined,
    isError: shape.error !== false,
    error: shape.error,
    shape,
    stream: shapeStream,
  })

  // Initial load
  shape.rows.then(() => {
    result.data = shape.currentRows
    result.isLoading = false
    result.lastSyncedAt = shape.lastSyncedAt()
    result.isError = shape.error !== false
    result.error = shape.error
  })

  // Only subscribe if subscribe option is true or undefined (default is true)
  if (options.subscribe !== false) {
    const unsubscribe = shape.subscribe(() => {
      result.data = shape.currentRows
      result.isLoading = false
      result.lastSyncedAt = shape.lastSyncedAt()
      result.isError = shape.error !== false
      result.error = shape.error
    })

    onUnmounted(() => {
      unsubscribe()
    })
  }

  return result
}