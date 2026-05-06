import type { IncomingMessage, ServerResponse } from 'node:http'

export interface CorsOpts {
  origins: string[] | `*`
}

export function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  opts: CorsOpts
): boolean {
  const origin = req.headers.origin ?? ``
  const allowed =
    opts.origins === `*` ||
    (typeof origin === `string` && opts.origins.includes(origin))
  if (allowed) {
    res.setHeader(
      `Access-Control-Allow-Origin`,
      opts.origins === `*` ? `*` : origin
    )
    res.setHeader(`Access-Control-Allow-Methods`, `GET, POST, DELETE, OPTIONS`)
    res.setHeader(`Access-Control-Allow-Headers`, `Content-Type, Authorization`)
    res.setHeader(`Access-Control-Max-Age`, `600`)
  }
  if (req.method === `OPTIONS`) {
    res.statusCode = 204
    res.end()
    return true
  }
  return false
}
