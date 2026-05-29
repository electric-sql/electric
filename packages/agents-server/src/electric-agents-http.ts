/**
 * Shared HTTP utilities for Electric Agents route handlers.
 */

import { json } from 'itty-router'

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown
): Response {
  return json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status }
  )
}

export async function readRequestBody(request: Request): Promise<Uint8Array> {
  return new Uint8Array(await request.arrayBuffer())
}

export function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    if (
      key === `content-encoding` ||
      key === `content-length` ||
      key === `transfer-encoding` ||
      key === `connection` ||
      key.startsWith(`access-control-`)
    ) {
      return
    }
    headers[key] = value
  })
  headers[`access-control-allow-origin`] = `*`
  headers[`access-control-expose-headers`] = `*`
  return headers
}
