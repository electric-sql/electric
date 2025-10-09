import jwt from "jsonwebtoken"

const AUTH_SECRET =
  Deno.env.get(`AUTH_SECRET`) || `NFL5*0Bc#9U6E@tnmC&E7SUN6GwHfLmY`
const ELECTRIC_URL = Deno.env.get(`ELECTRIC_URL`) || `http://localhost:3000`

interface ShapeDefinition {
  table: string
  columns?: string
  namespace?: string
  where?: string
}

/**
 * Match `GET /v1/shape` requests.
 */
function isGetShapeRequest(method: string, path: string) {
  return method === `GET` && path.endsWith(`/v1/shape`)
}

/**
 * Allow requests with a valid JWT in the auth header.
 */
function verifyAuthHeader(headers: Headers) {
  const auth_header = headers.get(`Authorization`)

  if (auth_header === null) {
    return [false, null]
  }

  const token = auth_header.split(`Bearer `)[1]

  try {
    const claims = jwt.verify(token, AUTH_SECRET, { algorithms: [`HS256`] })

    return [true, claims]
  } catch (err) {
    console.warn(err)

    return [false, null]
  }
}

/**
 * Allow requests where the signed `shape` definition in the JWT claims
 * matches the shape definition in the request `params`.
 */
function matchesDefinition(shape: ShapeDefinition, params: URLSearchParams) {
  if (shape === null || !shape.hasOwnProperty(`table`)) {
    return false
  }

  const table =
    shape.namespace !== null ? `${shape.namespace}.${shape.table}` : shape.table

  if (table === null || table !== params.get(`table`)) {
    return false
  }

  if (shape.where !== params.get(`where`)) {
    return false
  }

  if (shape.columns !== params.get(`columns`)) {
    return false
  }

  return true
}

// Handle requests to the server / edge function.
Deno.serve((req) => {
  const url = new URL(req.url)
  if (!isGetShapeRequest(req.method, url.pathname)) {
    return new Response(`Not found`, { status: 404 })
  }

  const [isValidJWT, claims] = verifyAuthHeader(req.headers)
  if (!isValidJWT) {
    return new Response(`Unauthorized`, { status: 401 })
  }

  if (!matchesDefinition(claims.shape, url.searchParams)) {
    return new Response(`Forbidden`, { status: 403 })
  }

  // Reverse-proxy the request on to the Electric sync service.
  return fetch(`${ELECTRIC_URL}/v1/shape${url.search}`, {
    headers: req.headers,
  })
})
