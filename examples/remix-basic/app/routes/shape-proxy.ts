import type { LoaderFunctionArgs } from "@remix-run/node"

export async function loader({ params, request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const originUrl = new URL(`http://localhost:3000/v1/shape`)
  url.searchParams.forEach((value, key) => {
    originUrl.searchParams.set(key, value)
  })

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
