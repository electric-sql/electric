import type { LoaderFunctionArgs } from "@remix-run/node"

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const originUrl = new URL(`http://localhost:3000/v1/shape`)
  url.searchParams.forEach((value, key) => {
    originUrl.searchParams.set(key, value)
  })

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
