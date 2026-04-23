/**
 * Shared HTTP utilities for Electric Agents route handlers.
 */

import { ElectricAgentsError } from './electric-agents-manager'
import type { IncomingMessage, ServerResponse } from 'node:http'

export function sendJsonError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string
): void {
  res.writeHead(status, { 'content-type': `application/json` })
  res.end(JSON.stringify({ error: { code, message } }))
}

export function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown
): void {
  res.writeHead(status, { 'content-type': `application/json` })
  res.end(JSON.stringify(data))
}

export function handleElectricAgentsError(
  err: unknown,
  res: ServerResponse
): void {
  if (err instanceof ElectricAgentsError) {
    const errorBody: Record<string, unknown> = {
      code: err.code,
      message: err.message,
    }
    if (err.details) {
      errorBody.details = err.details
    }
    res.writeHead(err.status, { 'content-type': `application/json` })
    res.end(JSON.stringify({ error: errorBody }))
  } else {
    throw err
  }
}

export async function parseJsonBody<T>(
  req: IncomingMessage,
  res: ServerResponse
): Promise<T | null> {
  const body = await readBody(req)
  try {
    return JSON.parse(new TextDecoder().decode(body)) as T
  } catch {
    sendJsonError(res, 400, `INVALID_REQUEST`, `Invalid JSON body`)
    return null
  }
}

export function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Array<Buffer> = []
    req.on(`data`, (chunk: Buffer) => chunks.push(chunk))
    req.on(`end`, () => resolve(new Uint8Array(Buffer.concat(chunks))))
    req.on(`error`, reject)
  })
}
