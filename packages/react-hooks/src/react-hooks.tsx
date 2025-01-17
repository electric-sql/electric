import {
  Shape,
  ShapeStream,
  ShapeStreamOptions,
  Row,
  GetExtensions,
  Offset,
} from '@electric-sql/client'
import React from 'react'
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector.js'

declare global {
  var document: {
    getElementById(id: string): { textContent?: string } | null
  } | undefined
}

type UnknownShape = Shape<Row<unknown>>
type UnknownShapeStream = ShapeStream<Row<unknown>>

const streamCache = new Map<string, UnknownShapeStream>()
const shapeCache = new Map<UnknownShapeStream, UnknownShape>()

// SSR types
interface SSRShapeData<T extends Row<unknown>> {
  rows: [string, T][] // Array of [key, value] tuples
  lastSyncedAt: number | undefined
  offset: Offset | undefined
  handle: string | undefined
}

interface SSRState {
  shapes: { [key: string]: SSRShapeData<any> }
}

let ssrState: SSRState | undefined

function hydrateSSRState() {
  if (typeof globalThis !== 'undefined' && globalThis.document) {
    const scriptEl = globalThis.document.getElementById('__ELECTRIC_SSR_STATE__')
    if (scriptEl?.textContent) {
      try {
        ssrState = JSON.parse(scriptEl.textContent)
      } catch (e) {
        console.error('Failed to parse SSR state:', e)
      }
    }
  }
}

hydrateSSRState()

export async function preloadShape<T extends Row<unknown>>(
  options: ShapeStreamOptions<GetExtensions<T>>
): Promise<Shape<T>> {
  const shapeStream = getShapeStream<T>(options, sortedOptionsHash(options))
  return getShape<T>(shapeStream, sortedOptionsHash(options))
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
  options: ShapeStreamOptions<GetExtensions<T>>,
  optionsHash: string
): ShapeStream<T> {
  // If the stream is already cached, return it if valid
  if (streamCache.has(optionsHash)) {
    const cachedStream = streamCache.get(optionsHash)!
    if (!cachedStream.options.signal?.aborted) {
      return cachedStream as ShapeStream<T>
    }
    streamCache.delete(optionsHash)
  }

  // Create stream with SSR offset if available
  const streamOptions = {
    ...options,
    offset: ssrState?.shapes[optionsHash]?.offset,
    handle: ssrState?.shapes[optionsHash]?.handle,
  }

  const newShapeStream = new ShapeStream<T>(streamOptions)
  streamCache.set(optionsHash, newShapeStream)
  return newShapeStream
}

export function getShape<T extends Row<unknown>>(
  shapeStream: ShapeStream<T>,
  optionsHash: string
): Shape<T> {
  // If the stream is already cached, return it if valid
  if (shapeCache.has(shapeStream)) {
    if (!shapeStream.options.signal?.aborted) {
      return shapeCache.get(shapeStream)! as Shape<T>
    }
    shapeCache.delete(shapeStream)
  }

  // Create new shape
  const newShape = new Shape<T>(shapeStream)

  // Check for SSR data
  const ssrData = ssrState?.shapes[optionsHash]

  if (ssrData) {
    // Initialize shape with SSR data - convert array of entries back to Map
    const dataMap = new Map(ssrData.rows)
    newShape.initializeWithSSRData(dataMap)
  }

  shapeCache.set(shapeStream, newShape)
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
    stream: shape.stream as ShapeStream<T>,
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

// Function to serialize SSR state for ElectricScripts
function serializeSSRState(): string {
  const shapes: { [key: string]: SSRShapeData<any> } = {}
  
  // Get shapes data from caches
  for (const [optionsHash, stream] of streamCache.entries()) {
    const shape = shapeCache.get(stream)
    if (shape) {
      shapes[optionsHash] = {
        rows: Array.from(shape.currentValue.entries()),
        lastSyncedAt: shape.lastSyncedAt(),
        offset: shape.offset,
        handle: shape.handle,
      }
    }
  }

  return JSON.stringify({ shapes })
}

export function ElectricScripts() {
  if (typeof globalThis !== 'undefined' && globalThis.document) {
    return null
  }

  return (
    <script
      id="__ELECTRIC_SSR_STATE__"
      type="application/json"
      dangerouslySetInnerHTML={{
        __html: serializeSSRState(),
      }}
    />
  )
}

export function useShape<
  SourceData extends Row<unknown> = Row,
  Selection = UseShapeResult<SourceData>,
>({
  selector = identity as (arg: UseShapeResult<SourceData>) => Selection,
  ...options
}: UseShapeOptions<SourceData, Selection>): Selection {
  // Calculate options hash once
  const optionsHash = sortedOptionsHash(options as ShapeStreamOptions<GetExtensions<SourceData>>)
  
  const shapeStream = getShapeStream<SourceData>(
    options as ShapeStreamOptions<GetExtensions<SourceData>>,
    optionsHash
  )
  const shape = getShape<SourceData>(shapeStream, optionsHash)

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
