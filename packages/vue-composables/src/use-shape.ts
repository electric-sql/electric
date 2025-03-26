import {
  Shape,
  ShapeStream,
  ShapeStreamOptions,
  Row,
  GetExtensions,
} from '@electric-sql/client'
import { Ref, onUnmounted, toRef, watch, ref } from 'vue'

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

export interface UseShapeOptions<T extends Row<unknown> = Row> extends ShapeStreamOptions<GetExtensions<T>> {
  /**
   * Custom fetch client for making requests
   * @type {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>}
   */
  fetchClient?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  /**
   * Whether to subscribe to shape changes after initial load
   * @type {boolean}
   * @default true
   */
  subscribe?: boolean;
}

export interface UseShapeResult<T extends Row<unknown> = Row> {
  /**
   * The ref containing array of rows that make up the Shape.
   * @type {Ref<T[]>}
   */
  data: Ref<T[]>
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
   * Ref containing loading state. True during initial fetch. False afterwise.
   * @type {Ref<boolean>}
   */
  isLoading: Ref<boolean>
  /**
   * Ref containing Unix time at which we last synced. Undefined when `isLoading` is true.
   * @type {Ref<number | undefined>}
   */
  lastSyncedAt: Ref<number | undefined>
  /**
   * Ref containing the error state of the Shape
   * @type {Ref<Shape<T>['error']>}
   */
  error: Ref<Shape<T>['error']>
  /**
   * Ref indicating if there is an error
   * @type {Ref<boolean>}
   */
  isError: Ref<boolean>
}

/**
 * Vue composable for using ElectricSQL shapes
 */
export function index<T extends Row<unknown> = Row>(
  options: UseShapeOptions<T>
): UseShapeResult<T> {
  // Extract fetchClient from options if provided
  const { fetchClient, ...streamOptions } = options;

  // If fetchClient is provided, override fetch for this request
  let originalFetch: typeof fetch | undefined;
  if (fetchClient) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      return fetchClient(input, init);
    };
  }

  // Create shape and stream instances
  const shapeStream = getShapeStream<T>(streamOptions);
  const shape = getShape<T>(shapeStream);

  // Restore original fetch after shape is created
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }

  // Create reactive references
  const data = ref(shape.currentRows) as Ref<T[]>;
  const isLoading = ref(shape.isLoading());
  const lastSyncedAt = ref(shape.lastSyncedAt());
  const isError = ref(shape.error !== false);
  const error = ref(shape.error);


  // Only subscribe if subscribe option is true or undefined (default is true)
  if (options.subscribe !== false) {
    // Subscribe to shape changes
    const unsubscribe = shape.subscribe(({ rows }) => {
      data.value = rows;
      isLoading.value = shape.isLoading();
      lastSyncedAt.value = shape.lastSyncedAt();
      isError.value = shape.error !== false;
      error.value = shape.error;
    });

    // Clean up subscription when component unmounts
    onUnmounted(() => {
      unsubscribe();
    });
  }

  return {
    data,
    isLoading,
    lastSyncedAt,
    isError,
    error,
    shape,
    stream: shapeStream
  }
}

/**
 * Vue composable for using ElectricSQL shapes
 * This follows the same naming convention as the React hook
 */
export function useShape<T extends Row<unknown> = Row>(
  options: UseShapeOptions<T>
): UseShapeResult<T> {
  return index<T>(options);
}