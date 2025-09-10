import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"

/**
 * Prepares the Electric SQL proxy URL from a request URL
 * Copies over Electric-specific query params and adds auth if configured
 * @param requestUrl - The incoming request URL
 * @returns The prepared Electric SQL origin URL
 */
export function prepareElectricUrl(requestUrl: string): URL {
  const url = new URL(requestUrl)
  const electricUrl =
    process.env.NODE_ENV === `production`
      ? `https://api.electric-sql.cloud`
      : `http://localhost:3000`
  const originUrl = new URL(`${electricUrl}/v1/shape`)

  // Copy Electric-specific query params
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Add Electric Cloud authentication if configured
  if (process.env.ELECTRIC_SOURCE_ID && process.env.ELECTRIC_SOURCE_SECRET) {
    originUrl.searchParams.set(`source_id`, process.env.ELECTRIC_SOURCE_ID)
    originUrl.searchParams.set(
      `source_secret`,
      process.env.ELECTRIC_SOURCE_SECRET
    )
  }

  return originUrl
}

/**
 * Proxies a request to Electric SQL and returns the response
 * @param originUrl - The prepared Electric SQL URL
 * @returns The proxied response
 */
export async function proxyElectricRequest(originUrl: URL): Promise<Response> {
  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)
  headers.delete(`content-encoding`)
  headers.delete(`content-length`)
  headers.set(`vary`, `cookie`)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
