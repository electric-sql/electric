import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const originUrl = new URL(
    process.env.ELECTRIC_URL
      ? `${process.env.ELECTRIC_URL}/v1/shape`
      : "http://localhost:3000/v1/shape"
  )

  // Only pass through Electric protocol parameters, not table name
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set the table server-side - not from client params
  originUrl.searchParams.set("table", "items")

  if (process.env.ELECTRIC_SOURCE_ID) {
    originUrl.searchParams.set("source_id", process.env.ELECTRIC_SOURCE_ID)
  }

  const headers = new Headers()
  if (process.env.ELECTRIC_SOURCE_SECRET) {
    originUrl.searchParams.set("secret", process.env.ELECTRIC_SOURCE_SECRET)
  }

  const newRequest = new Request(originUrl.toString(), {
    method: "GET",
    headers,
  })

  // When proxying long-polling requests, content-encoding & content-length are added
  // erroneously (saying the body is gzipped when it's not) so we'll just remove
  // them to avoid content decoding errors in the browser.
  //
  // Similar-ish problem to https://github.com/wintercg/fetch/issues/23
  let resp = await fetch(newRequest)
  if (resp.headers.get("content-encoding")) {
    const headers = new Headers(resp.headers)
    headers.delete("content-encoding")
    headers.delete("content-length")
    resp = new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    })
  }
  return resp
}
