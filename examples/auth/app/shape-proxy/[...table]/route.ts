export async function GET(
  request: Request,
  { params }: { params: { table: string } }
) {
  const url = new URL(request.url)
  const { table } = params

  // Constuct the upstream URL
  const originUrl = new URL(`http://localhost:3000/v1/shape/${table}`)
  url.searchParams.forEach((value, key) => {
    originUrl.searchParams.set(key, value)
  })

  // authentication and authorization
  const authorization = request.headers.get(`authorization`)

  // If the user isn't set, return 403
  if (!authorization) {
    return new Response(`authorization header not found`, { status: 403 })
  }

  // Only query orgs the user has access to.
  if (authorization && authorization !== `admin`) {
    originUrl.searchParams.set(`where`, `"org_id" = ${authorization}`)
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
