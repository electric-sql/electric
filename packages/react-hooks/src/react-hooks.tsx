import {
  Shape,
  ShapeStream,
  ShapeStreamOptions,
  Row,
  GetExtensions,
} from '@electric-sql/client'
import React from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector.js'

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

export function sortedOptionsHash<T>(options: ShapeStreamOptions<T>): string {
  const hashOptions = {
    url: options.url,
    where: options.where,
    columns: options.columns,
    headers: options.headers,
  }

  return JSON.stringify(hashOptions, Object.keys(hashOptions).sort())
}

export function getShapeStream<T extends Row<unknown>>(
  options: ShapeStreamOptions<GetExtensions<T>>
): ShapeStream<T> {
  const shapeHash = sortedOptionsHash(options)

  // If the stream is already cached, return it if valid
  if (streamCache.has(shapeHash)) {
    const stream = streamCache.get(shapeHash)! as ShapeStream<T>
    if (stream.error === undefined && !stream.options.signal?.aborted) {
      return stream
    }

    // if stream is cached but errored/aborted, remove it and related shapes
    streamCache.delete(shapeHash)
    shapeCache.delete(stream)
  }

  const newShapeStream = new ShapeStream<T>(options)

  streamCache.set(shapeHash, newShapeStream)

  // Return the created shape
  return newShapeStream
}

export function getShape<T extends Row<unknown>>(
  shapeStream: ShapeStream<T>
): Shape<T> {
  // If the stream is already cached, return it if valid
  if (shapeCache.has(shapeStream)) {
    if (
      shapeStream.error === undefined &&
      !shapeStream.options.signal?.aborted
    ) {
      return shapeCache.get(shapeStream)! as Shape<T>
    }

    // if stream is cached but errored/aborted, remove it and related shapes
    streamCache.delete(sortedOptionsHash(shapeStream.options))
    shapeCache.delete(shapeStream)
  }

  const newShape = new Shape<T>(shapeStream)

  shapeCache.set(shapeStream, newShape)

  // Return the created shape
  return newShape
}

export interface UseShapeResult<T extends Row<unknown> = Row> {
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

function shapeSubscribe<T extends Row<unknown>>(
  shape: Shape<T>,
  callback: () => void
) {
  const unsubscribe = shape.subscribe(callback)
  return () => {
    unsubscribe()
  }
}

function parseShapeData<T extends Row<unknown>>(
  shape: Shape<T>
): UseShapeResult<T> {
  return {
    data: shape.currentRows,
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

interface UseShapeOptions<SourceData extends Row<unknown>, Selection>
  extends ShapeStreamOptions<GetExtensions<SourceData>> {
  selector?: (value: UseShapeResult<SourceData>) => Selection
}

export function useShape<
  SourceData extends Row<unknown> = Row,
  Selection = UseShapeResult<SourceData>,
>({
  selector = identity as (arg: UseShapeResult<SourceData>) => Selection,
  ...options
}: UseShapeOptions<SourceData, Selection>): Selection {
  const shapeStream = getShapeStream<SourceData>(
    options as ShapeStreamOptions<GetExtensions<SourceData>>
  )
  const shape = getShape<SourceData>(shapeStream)

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
