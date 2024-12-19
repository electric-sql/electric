export async function GET(request: Request) {
  const url = new URL(request.url)

  // Constuct the upstream URL
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

  // authentication and authorization
  // Note: in a real-world authentication scheme, this is where you would
  // veryify the authentication token and load the user. To keep this example simple,
  // we're just passing directly through the org_id.
  const org_id = request.headers.get(`authorization`)
  let user
  if (org_id) {
    user = { org_id, isAdmin: org_id === `admin` }
  }

  // If the user isn't set, return 401
  if (!user) {
    return new Response(`authorization header not found`, { status: 401 })
  }

  // Only query orgs the user has access to.
  if (!user.isAdmin) {
    originUrl.searchParams.set(`where`, `"org_id" = ${user.org_id}`)
  }

  // When proxying long-polling requests, content-encoding & content-length are added
  // erroneously (saying the body is gzipped when it's not) so we'll just remove
  // them to avoid content decoding errors in the browser.
  //
  // Similar-ish problem to https://github.com/wintercg/fetch/issues/23
  const resp = await fetch(originUrl)
  if (resp.headers.get(`content-encoding`)) {
    const headers = new Headers(resp.headers)
    headers.delete(`content-encoding`)
    headers.delete(`content-length`)
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    })
  }
  return resp
}
