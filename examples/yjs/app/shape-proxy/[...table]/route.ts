export async function GET(request: Request) {
  const url = new URL(request.url)
  const originUrl = new URL(
    process.env.ELECTRIC_URL
      ? `${process.env.ELECTRIC_URL}/v1/shape/`
      : `http://localhost:3000/v1/shape/`
  )

  url.searchParams.forEach((value, key) => {
    originUrl.searchParams.set(key, value)
  })

  if (process.env.ELECTRIC_SOURCE_ID) {
    originUrl.searchParams.set(`source_id`, process.env.ELECTRIC_SOURCE_ID)
  }

  if (process.env.ELECTRIC_SOURCE_SECRET) {
    originUrl.searchParams.set(
      `source_secret`,
      process.env.ELECTRIC_SOURCE_SECRET
    )
  }

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
