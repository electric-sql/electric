import {
  Shape,
  ShapeStream,
  ShapeStreamOptions,
  Row,
  ShapeData,
  Offset,
} from '@electric-sql/client'
import React from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector.js'

export type SerializedShapeData = {
  offset: Offset
  shapeId: string | undefined
  data?: Record<string, unknown>
}

const streamCache = new Map<string, ShapeStream>()
const shapeCache = new Map<ShapeStream, Shape>()

export async function preloadShape<T extends Row = Row>(
  options: ShapeStreamOptions
): Promise<Shape<T>> {
  const shapeStream = getShapeStream<T>(options)
  const shape = getShape<T>(shapeStream)
  await shape.value
  return shape
}

export function sortedOptionsHash(options: ShapeStreamOptions): string {
  return JSON.stringify(options, Object.keys(options).sort())
}

export function getShapeStream<T extends Row = Row>(
  options: ShapeStreamOptions
): ShapeStream<T> {
  const shapeHash = sortedOptionsHash(options)

  // If the stream is already cached, return
  if (streamCache.has(shapeHash)) {
    // Return the ShapeStream
    return streamCache.get(shapeHash)! as ShapeStream<T>
  } else {
    const newShapeStream = new ShapeStream<T>(options)

    streamCache.set(shapeHash, newShapeStream)

    // Return the created shape
    return newShapeStream
  }
}

export function getShape<T extends Row>(
  shapeStream: ShapeStream<T>,
  shapeData?: ShapeData
): Shape<T> {
  // If the stream is already cached, return
  if (shapeCache.has(shapeStream)) {
    // Return the ShapeStream
    return shapeCache.get(shapeStream)! as Shape<T>
  } else {
    const newShape = new Shape<T>(shapeStream, shapeData)

    shapeCache.set(shapeStream, newShape)

    // Return the created shape
    return newShape
  }
}

export interface UseShapeResult<T extends Row = Row> {
  /**
   * The array of rows that make up the Shape.
   * @type {T[]}
   */
  data: T[]
  /**
   * The Shape instance used by this useShape
   * @type {Shape<T>}
   */
  shape: Shape<T>
  /** True during initial fetch. False afterwise. */
  isLoading: boolean
  /** Unix time at which we last synced. Undefined when `isLoading` is true. */
  lastSyncedAt?: number
  error: Shape<T>[`error`]
  isError: boolean
}

function shapeSubscribe<T extends Row>(shape: Shape<T>, callback: () => void) {
  const unsubscribe = shape.subscribe(callback)
  return () => {
    unsubscribe()
  }
}

function parseShapeData<T extends Row>(shape: Shape<T>): UseShapeResult<T> {
  return {
    data: [...shape.valueSync.values()],
    isLoading: shape.isLoading(),
    lastSyncedAt: shape.lastSyncedAt(),
    isError: shape.error !== false,
    shape,
    error: shape.error,
  }
}

function identity<T>(arg: T): T {
  return arg
}

interface UseShapeOptions<SourceData extends Row, Selection>
  extends ShapeStreamOptions {
  selector?: (value: UseShapeResult<SourceData>) => Selection
  shapeData?: ShapeData
}

export function useShape<
  SourceData extends Row = Row,
  Selection = UseShapeResult<SourceData>,
>({
  selector = identity as (arg: UseShapeResult<SourceData>) => Selection,
  shapeData: data,
  ...options
}: UseShapeOptions<SourceData, Selection>): Selection {
  const shapeStream = getShapeStream<SourceData>(options as ShapeStreamOptions)
  const shape = getShape<SourceData>(shapeStream, data)

  const useShapeData = React.useMemo(() => {
    let latestShapeData = parseShapeData(shape)
    const getSnapshot = () => latestShapeData
    const subscribe = (onStoreChange: () => void) =>
      shapeSubscribe(shape, () => {
        latestShapeData = parseShapeData(shape)
        onStoreChange()
      })

    return () => {
      return useSyncExternalStoreWithSelector(
        subscribe,
        getSnapshot,
        getSnapshot,
        selector
      )
    }
  }, [shape, selector])

  return useShapeData()
}
export function getSerializedShape(
  options: ShapeStreamOptions
): SerializedShapeData {
  const shapeStream = getShapeStream(options)
  const shape = getShape(shapeStream)
  return {
    shapeId: shapeStream.shapeId,
    offset: shapeStream.offset,
    data: Object.fromEntries(shape.valueSync),
  }
}
