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

  // Return the created shape
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

  // Return the created shape
  return newShape
}

export interface UseShapeResultEnabled<T extends Row<unknown> = Row> {
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
  /**
   * The ShapeStream instance used by this Shape
   * @type {ShapeStream<T>}
   */
  stream: ShapeStream<T>
  /** True during initial fetch. False afterwise. */
  isLoading: boolean
  /** Unix time at which we last synced. Undefined when `isLoading` is true. */
  lastSyncedAt?: number
  error: Shape<T>[`error`]
  isError: boolean
  /** True when the shape is enabled and active */
  isEnabled: true
}

export interface UseShapeResultDisabled<T extends Row<unknown> = Row> {
  /**
   * Empty array when disabled
   * @type {T[]}
   */
  data: T[]
  /** Undefined when disabled */
  shape: undefined
  /** Undefined when disabled */
  stream: undefined
  /** False when disabled */
  isLoading: false
  /** Undefined when disabled */
  lastSyncedAt: undefined
  /** Undefined when disabled */
  error: undefined
  /** False when disabled */
  isError: false
  /** False when the shape is disabled */
  isEnabled: false
}

export type UseShapeResult<T extends Row<unknown> = Row> =
  | UseShapeResultEnabled<T>
  | UseShapeResultDisabled<T>

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
): UseShapeResultEnabled<T> {
  return {
    data: shape.currentRows,
    isLoading: shape.isLoading(),
    lastSyncedAt: shape.lastSyncedAt(),
    isError: shape.error !== false,
    shape,
    stream: shape.stream as ShapeStream<T>,
    error: shape.error,
    isEnabled: true,
  }
}

function shapeResultChanged<T extends Row<unknown>>(
  oldRes: UseShapeResult<T> | undefined,
  newRes: UseShapeResult<T>
): boolean {
  return (
    !oldRes ||
    oldRes.isEnabled !== newRes.isEnabled ||
    oldRes.isLoading !== newRes.isLoading ||
    oldRes.lastSyncedAt !== newRes.lastSyncedAt ||
    oldRes.isError !== newRes.isError ||
    oldRes.error !== newRes.error ||
    (oldRes.isEnabled &&
      newRes.isEnabled &&
      (oldRes.shape.lastOffset !== newRes.shape.lastOffset ||
        oldRes.shape.handle !== newRes.shape.handle))
  )
}

function identity<T>(arg: T): T {
  return arg
}

interface UseShapeOptions<SourceData extends Row<unknown>, Selection>
  extends ShapeStreamOptions<GetExtensions<SourceData>> {
  selector?: (value: UseShapeResult<SourceData>) => Selection
  /** Whether the shape should be enabled. Defaults to true when undefined. */
  enabled?: boolean
}

export function useShape<
  SourceData extends Row<unknown> = Row,
  Selection = UseShapeResultEnabled<SourceData>,
>(
  options: UseShapeOptions<SourceData, Selection> & { enabled: true }
): Selection
export function useShape<
  SourceData extends Row<unknown> = Row,
  Selection = UseShapeResultDisabled<SourceData>,
>(
  options: UseShapeOptions<SourceData, Selection> & { enabled: false }
): Selection
export function useShape<
  SourceData extends Row<unknown> = Row,
  Selection = UseShapeResultEnabled<SourceData>,
>(
  options: UseShapeOptions<SourceData, Selection> & {
    enabled?: true | undefined
  }
): Selection
export function useShape<
  SourceData extends Row<unknown> = Row,
  Selection = UseShapeResult<SourceData>,
>(
  options: UseShapeOptions<SourceData, Selection> & { enabled?: boolean }
): Selection
export function useShape<
  SourceData extends Row<unknown> = Row,
  Selection = UseShapeResult<SourceData>,
>({
  selector = identity as (arg: UseShapeResult<SourceData>) => Selection,
  enabled = true,
  ...options
}: UseShapeOptions<SourceData, Selection>): Selection {
  const shapeStream = enabled
    ? getShapeStream<SourceData>(
        options as ShapeStreamOptions<GetExtensions<SourceData>>
      )
    : null
  const shape =
    enabled && shapeStream ? getShape<SourceData>(shapeStream) : null

  // Stable disabled result
  const disabledResult = React.useMemo(
    (): UseShapeResultDisabled<SourceData> => ({
      data: [],
      shape: undefined,
      stream: undefined,
      isLoading: false,
      lastSyncedAt: undefined,
      error: undefined,
      isError: false,
      isEnabled: false,
    }),
    []
  )

  const useShapeData = React.useMemo(() => {
    let latestShapeData: UseShapeResultEnabled<SourceData> | undefined

    const getSnapshot = () => {
      if (!enabled || !shape) return disabledResult
      latestShapeData ??= parseShapeData(shape)
      return latestShapeData
    }

    const subscribe = (onStoreChange: () => void) => {
      if (!enabled || !shape) {
        return () => {}
      }

      // check if shape has changed between the initial snapshot
      // and subscribing, as there are no guarantees that the
      // two will occur synchronously with each other
      const newShapeData = parseShapeData(shape)
      if (shapeResultChanged(latestShapeData, newShapeData)) {
        latestShapeData = newShapeData
        onStoreChange()
      }

      return shapeSubscribe(shape, () => {
        latestShapeData = parseShapeData(shape)
        onStoreChange()
      })
    }

    return () =>
      useSyncExternalStoreWithSelector(
        subscribe,
        getSnapshot,
        getSnapshot,
        selector
      )
  }, [enabled, shape, selector, disabledResult])

  return useShapeData()
}
