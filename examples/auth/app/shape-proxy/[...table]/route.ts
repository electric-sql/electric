import { Client } from 'pg'

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
  const encodedCredentials = request.headers.get(`authorization`)

  if (!encodedCredentials) {
    return new Response(`authorization header not found`, { status: 401 })
  }

  const decoded = decodeCredentials(encodedCredentials)

  if (decoded === undefined) {
    return new Response(`invalid authorization header`, { status: 401 })
  }

  // Check that the username and password are correct
  const userInfo = await checkCredentials(decoded)
  if (userInfo === false) {
    return new Response(`user not found or invalid username and password combination`, { status: 401 })
  }

  if (userInfo === undefined) {
    return new Response(`database unreachable`, { status: 503 })
  }

  const { orgId } = userInfo
  // Only query orgs the user has access to.
  if (orgId !== null) {
    originUrl.searchParams.set(`where`, `"org_id" = ${orgId}`)
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

/** Decodes basic auth header containing base64-encoded credentials. */
type Credentials = { username: string, password: string }
function decodeCredentials(creds: string): Credentials | undefined {
  const base64Creds = creds.slice("Basic ".length)
  const buff = Buffer.from(base64Creds, "base64")
  const decoded = buff.toString("utf8")
  if (decoded.includes(":")) {
    const [username, password] = decoded.split(":") // username can't contain a colon in basic auth!
    return { username, password }
  } else {
    return undefined
  }
}

/**
 * Checks the provided credentials against those that are stored in the DB.
 * Returns the orgId and role of the user if the credentials are valid.
 * Returns false if the credentials are invalid.
 * Returns undefined if the database is unreachable.
 */
async function checkCredentials({ username, password }: Credentials): Promise<{ orgId?: number, role: string } | false | undefined> {
  const connectionUrl = process.env.DATABASE_URL ?? `postgresql://postgres:password@localhost:54321/electric`

  const client = new Client(connectionUrl)
  await client.connect()

  try {
    const { rows } = await client.query(
      'SELECT org_id, role FROM users WHERE name = $1 AND password = $2',
      [username, password]
    )
    if (rows.length === 0) {
      return false
    }
    
    const { org_id, user_role } = rows[0]
    return { orgId: org_id, role: user_role }
  } catch (err: any) {
      console.log("DB ERROR")
      console.log(err.message)
     return undefined
  } finally {
     await client.end()
  }
}