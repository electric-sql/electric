import type { LoaderFunctionArgs } from "@remix-run/node"

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const baseUrl = process.env.ELECTRIC_URL ?? `http://localhost:3000`
  const originUrl = new URL(`/v1/shape`, baseUrl)
  url.searchParams.forEach((value, key) => {
    originUrl.searchParams.set(key, value)
  })

  if (process.env.DATABASE_ID) {
    originUrl.searchParams.set(`database_id`, process.env.DATABASE_ID)
  }

  if (process.env.ELECTRIC_TOKEN) {
    originUrl.searchParams.set(`token`, process.env.ELECTRIC_TOKEN)
  }

  // When proxying long-polling requests, content-encoding & content-length are added
  // erroneously (saying the body is gzipped when it's not) so we'll just remove
  // them to avoid content decoding errors in the browser.
  //
  // Similar-ish problem to https://github.com/wintercg/fetch/issues/23
  let resp = await fetch(originUrl.toString())
  if (resp.headers.get(`content-encoding`)) {
    const headers = new Headers(resp.headers)
    headers.delete(`content-encoding`)
    headers.delete(`content-length`)
    resp = new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    })
  }
  return resp
}
