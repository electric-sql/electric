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

let __ELECTRIC_SSR_STATE__: SSRState | undefined

function hydrateSSRState() {
  if (typeof globalThis !== 'undefined' && globalThis.document) {
    const scriptEl = globalThis.document.getElementById('__ELECTRIC_SSR_STATE__')
    if (scriptEl?.textContent) {
      try {
        const state = JSON.parse(scriptEl.textContent) as SSRState
        setSSRState(state)
      } catch (e) {
        console.error('Failed to parse SSR state:', e)
      }
    }
  }
}

hydrateSSRState()

export function getSSRState(): SSRState {
  if (typeof globalThis !== 'undefined' && 'window' in globalThis && typeof (globalThis as any).window?.__ELECTRIC_SSR_STATE__ !== 'undefined') {
    return (globalThis as any).window.__ELECTRIC_SSR_STATE__
  }
  return __ELECTRIC_SSR_STATE__ || { shapes: {} }
}

export function setSSRState(state: SSRState) {
  if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
    (globalThis as any).window.__ELECTRIC_SSR_STATE__ = state
  } else {
    __ELECTRIC_SSR_STATE__ = state
  }
}

export async function preloadShape<T extends Row<unknown>>(
  options: ShapeStreamOptions<GetExtensions<T>>
): Promise<Shape<T>> {
  const shape = getShape<T>(getShapeStream<T>(options, sortedOptionsHash(options)), sortedOptionsHash(options))
  const shapeHash = sortedOptionsHash(options)

  // Store in SSR state
  const shapeData = {
    rows: Array.from(shape.currentValue.entries()),
    lastSyncedAt: shape.lastSyncedAt(),
    offset: shape.offset,
    handle: shape.handle,
  }

  setSSRState({
    ...getSSRState(),
    shapes: {
      ...getSSRState().shapes,
      [shapeHash]: shapeData,
    },
  })

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

  // Check for SSR data to get the offset
  const ssrState = getSSRState()
  const ssrData = ssrState.shapes[optionsHash] as SSRShapeData<T> | undefined

  // Create stream with SSR offset if available
  const streamOptions = {
    ...options,
    offset: ssrData?.offset,
    handle: ssrData?.handle,
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
  const ssrState = getSSRState()
  const ssrData = ssrState.shapes[optionsHash] as SSRShapeData<T> | undefined

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

// Function to serialize SSR state
export function serializeSSRState(): string {
  return `window.__ELECTRIC_SSR_STATE__ = ${JSON.stringify(getSSRState())};`
}

/**
 * Component to inject Electric SSR state into HTML
 */
export function ElectricScripts() {
  const ssrState = getSSRState()

  // Only inject script if we have SSR state
  if (Object.keys(ssrState.shapes).length === 0) {
    return null
  }

  // Serialize state and inject as script
  return (
    <script
      id="__ELECTRIC_SSR_STATE__"
      type="application/json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(ssrState)
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
