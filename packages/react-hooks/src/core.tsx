import {
  Shape,
  ShapeStream,
  ShapeStreamOptions,
  Row,
  GetExtensions,
  Offset,
} from '@electric-sql/client'

// Types shared across all modules
export interface SSRShapeData<T extends Row<unknown>> {
  rows: [string, T][] // Array of [key, value] tuples
  lastSyncedAt: number | undefined
  offset: Offset | undefined
  handle: string | undefined
}

export interface SSRState {
  shapes: { [key: string]: SSRShapeData<any> }
}

export const isSSR = typeof globalThis !== 'undefined' && !('window' in globalThis)

export class ShapeClient {
  private streamCache = new Map<string, ShapeStream<Row<unknown>>>()
  private shapeCache = new Map<ShapeStream<Row<unknown>>, Shape<Row<unknown>>>()
  private dehydratedState = new Map<string, SSRShapeData<any>>()

  public getShapeStream<T extends Row<unknown>>(
    options: ShapeStreamOptions<GetExtensions<T>>,
    optionsHash: string
  ): ShapeStream<T> {
    // Check if we have SSR data for this shape
    const ssrData = this.dehydratedState.get(optionsHash)

    if (this.streamCache.has(optionsHash)) {
      const cachedStream = this.streamCache.get(optionsHash)!
      if (!cachedStream.options.signal?.aborted) {
        return cachedStream as ShapeStream<T>
      }
      this.streamCache.delete(optionsHash)
    }

    // Create new stream with SSR data if available
    const newShapeStream = new ShapeStream<T>({
      ...options,
      // Initialize with SSR offset/handle if available
      ...(ssrData && {
        offset: ssrData.offset,
        handle: ssrData.handle,
      }),
    })

    this.streamCache.set(optionsHash, newShapeStream)
    return newShapeStream
  }

  public getShape<T extends Row<unknown>>(
    shapeStream: ShapeStream<T>
  ): Shape<T> {
    if (this.shapeCache.has(shapeStream)) {
      if (!shapeStream.options.signal?.aborted) {
        return this.shapeCache.get(shapeStream)! as Shape<T>
      }
      this.shapeCache.delete(shapeStream)
    }

    const newShape = new Shape<T>(shapeStream)

    // Initialize with SSR data if available
    const optionsHash = sortedOptionsHash(shapeStream.options)
    const ssrData = this.dehydratedState.get(optionsHash)
    if (ssrData) {
      const dataMap = new Map(ssrData.rows)
      newShape.initializeWithSSRData(dataMap)
    }

    this.shapeCache.set(shapeStream, newShape)
    return newShape
  }

  // For RSC/SSR to store state that will be hydrated
  public setDehydratedState(optionsHash: string, state: SSRShapeData<any>) {
    this.dehydratedState.set(optionsHash, state)
  }

  public getDehydratedState(): SSRState {
    return {
      shapes: Object.fromEntries(this.dehydratedState),
    }
  }

  // For hydrating from SSR state
  public hydrateFromState(state: SSRState) {
    Object.entries(state.shapes).forEach(([optionsHash, shapeData]) => {
      this.dehydratedState.set(optionsHash, shapeData)
    })
  }
}

// Global client for browser
const isServer = typeof globalThis === 'undefined' || !('window' in globalThis)
export const globalClient = !isServer ? new ShapeClient() : null

// Utils
export function sortObjectKeys(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys)
  }

  return (
    Object.keys(obj)
      .sort()
      .reduce<Record<string, any>>((sorted, key) => {
        sorted[key] = sortObjectKeys(obj[key])
        return sorted
      }, {})
  )
}

export function sortedOptionsHash<T>(options: ShapeStreamOptions<T>): string {
  return JSON.stringify(sortObjectKeys(options))
}

// Shape subscription
export function shapeSubscribe<T extends Row<unknown>>(
  shape: Shape<T>,
  callback: () => void
) {
  const unsubscribe = shape.subscribe(callback)
  return () => {
    unsubscribe()
  }
}

// Types for useShape
export interface UseShapeResult<T extends Row<unknown>> {
  data: T[]
  shape: Shape<T>
  stream: ShapeStream<T>
  isLoading: boolean
  lastSyncedAt?: number
  error: Shape<T>['error']
  isError: boolean
}

export function parseShapeData<T extends Row<unknown>>(
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

export function identity<T>(arg: T): T {
  return arg
}

export interface UseShapeOptions<SourceData extends Row<unknown>, Selection>
  extends ShapeStreamOptions<GetExtensions<SourceData>> {
  selector?: (value: UseShapeResult<SourceData>) => Selection
}
