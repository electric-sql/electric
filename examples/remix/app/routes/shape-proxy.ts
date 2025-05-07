import type { LoaderFunctionArgs } from "@remix-run/node"

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const baseUrl = process.env.ELECTRIC_URL ?? `http://localhost:3000`
  const originUrl = new URL(`/v1/shape`, baseUrl)
  url.searchParams.forEach((value, key) => {
    originUrl.searchParams.set(key, value)
  })

  originUrl.searchParams.set(`source_id`, process.env.ELECTRIC_SOURCE_ID!)
  originUrl.searchParams.set(`source_secret`, process.env.ELECTRIC_SOURCE_SECRET!)

  const response = await fetch(originUrl)

  // Fetch decompresses the body but doesn't remove the
  // content-encoding & content-length headers which would
  // break decoding in the browser.
  //
  // See https://github.com/whatwg/fetch/issues/1729
  const headers = new Headers(response.headers)
  headers.delete(`content-encoding`)
  headers.delete(`content-length`)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
