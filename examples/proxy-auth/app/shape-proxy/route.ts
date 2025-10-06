import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"

export async function GET(request: Request) {
  const url = new URL(request.url)

  // Constuct the upstream URL
  const baseUrl = process.env.ELECTRIC_URL ?? `http://localhost:3000`
  const originUrl = new URL(`/v1/shape`, baseUrl)
  // Only pass through Electric protocol parameters
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Set the table server-side
  originUrl.searchParams.set(`table`, `users`)

  if (process.env.ELECTRIC_SOURCE_ID) {
    originUrl.searchParams.set(`source_id`, process.env.ELECTRIC_SOURCE_ID)
  }

  if (process.env.ELECTRIC_SOURCE_SECRET) {
    originUrl.searchParams.set(`secret`, process.env.ELECTRIC_SOURCE_SECRET)
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
    // Note: For production, use a type-safe query builder like Drizzle or Kysely
    // to generate WHERE clauses with compile-time type safety. See:
    // https://electric-sql.com/docs/guides/auth#type-safe-where-clause-generation
    originUrl.searchParams.set(`where`, `"org_id" = '${user.org_id}'`)
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
  headers.set(`Vary`, `Authorization`)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
