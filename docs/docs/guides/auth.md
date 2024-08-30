---
outline: deep
---

# Auth

How to authenticate users and authorize data access.

## Authentication and Authorization

Most sync engines require you to use their APIs for authentication and authorization.

But as [Electric is built on the standard HTTP protocol](/docs/api/http), you can handle auth for Electric exactly the same as you do the rest of the (HTTP) API calls in your app.

At a high level the pattern for auth is:

1. Add an `Authorization` header to authenticate the client when requesting [shape](/docs/guides/shapes) data.
2. The API uses the header to check that the client exists and has access to the requested data.
3. If not, it returns a 401 or 403 status to tell the client it doesn't have access.
4. If the client does have access, the API then requests the shape data from Electric and streams that back to the client.

In the app, you pass a `fetchWrapper` to the Electric client which adds your `Authorization` header when Electric requests shape data.

## Sample code

In the client:

```tsx
const fetchWrapper = async (...args: Parameters<typeof fetch>) => {
  const user = loadCurrentUser()
  const modifiedArgs = [...args]
  const headers = new Headers(
    (modifiedArgs[1] as RequestInit)?.headers || {}
  )

  // Set authorization token
  headers.set(`Authorization`, `Bearer ${user.token}`)

  modifiedArgs[1] = { ...(modifiedArgs[1] as RequestInit), headers }
  const response = await fetch(
    ...(modifiedArgs as [RequestInfo, RequestInit?])
  )
  return response
}

const usersShape = (): ShapeStreamOptions => {
  return {
    url: new URL(`/api/shapes/users`, window.location.origin).href,
    fetchClient: fetchWrapper,
  }
}

export default function ExampleComponent () {
  const { data: users } = useShape(usersShape())
}
```

Then for the `/api/shapes/users` route:

```tsx
export async function GET(
  request: Request,
  { params }: { params: { table: string } }
) {
  const url = new URL(request.url)
  const { table } = params

  // Constuct the upstream URL
  const originUrl = new URL(`http://localhost:3000/v1/shape/${table}`)

  // Copy over the shape_id & offset query params that the
  // Electric client adds so we return the right part of the Shape log.
  url.searchParams.forEach((value, key) => {
    if ([`shape_id`, `offset`].includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // authentication and authorization
  const user = await loadUser(request.headers.get(`authorization`))

  // If the user isn't set, return 401
  if (!user) {
    return new Response(`user not found`, { status: 401 })
  }

  // Only query data the user has access to unless they're an admin.
  if (!user.roles.includes(`admin`)) {
    originUrl.searchParams.set(`where`, `"org_id" = ${user.org_id}`)
  }

  // When proxying long-polling requests, content-encoding &
  // content-length are added erroneously (saying the body is
  // gzipped when it's not) so we'll just remove them to avoid
  // content decoding errors in the browser.
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
```
