import { Shape, ShapeStream } from '@electric-sql/client'

/**
 * One-time fetch of all rows from an Electric shape.
 * Uses the official Electric client which handles pagination,
 * offset tracking, and up-to-date detection.
 */
export async function fetchShapeRows<T = Record<string, unknown>>(
  baseUrl: string,
  table: string,
  options?: { signal?: AbortSignal }
): Promise<Array<T>> {
  const stream = new ShapeStream({
    url: `${baseUrl}/_electric/electric/v1/shape`,
    params: { table },
    subscribe: false,
    signal: options?.signal,
  })
  const shape = new Shape(stream)
  const rows = await shape.rows
  return rows as Array<T>
}
