---
title: Auth - Guide
description: >-
  How to authenticate users and authorize data access with Electric.
outline: deep
---

# Auth

How to authenticate users and authorize data access.

See our [auth example](https://github.com/electric-sql/electric/tree/main/examples/auth).

## Standard HTTP authentication and authorization

Electric [syncs data over HTTP](/docs/api/http). This means that (unlike other sync engines where you have to use their specific APIs for auth) with Electric you can authenticate and authorize data access the same way you do for normal web resources like API endpoints.

## Recommended pattern

The main pattern we recommend is to authorise at the [Shape](/docs/guides/shapes) level.

So when you make a request to sync a shape, route it via your API, validate the user credentials and shape parameters, and then only proxy the data through if authorised.

<figure>
  <a href="/img/guides/auth/proxy-flow.jpg">
    <img src="/img/guides/auth/proxy-flow.png" class="hidden-sm"
        alt="Illustration of the proxied auth flow"
    />
    <img src="/img/guides/auth/proxy-flow.sm.png" class="block-sm"
        alt="Illustration of the proxied auth flow"
    />
  </a>
</figure>

For example, you could implement with the following steps:

1. add an `Authorization` header to your [`GET /shape` request](/docs/api/http#syncing-shapes)
2. use the header to check that the client exists and has access to the requested data
3. if not, return a `401` or `403` status to tell the client it doesn't have access
4. if the client does have access, proxy the request to Electric and stream the response back to the client

### Using the Typescript client

When using the [Typescript client](/docs/api/clients/typescript), you can pass a `fetchWrapper` to the Electric client which adds your `Authorization` header when Electric requests shape data.

#### Sample code

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

  // Construct the upstream URL
  const originUrl = new URL(`http://localhost:3000/v1/shape/${table}`)

  // Copy over the shape_id & offset query params that the
  // Electric client adds so we return the right part of the Shape log.
  url.searchParams.forEach((value, key) => {
    if ([`shape_id`, `offset`].includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  //
  // Authentication and authorization
  //

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

### Integrating external auth services

Note that with this pattern, if you need it to, the auth endpoint that proxies the request to the Electric shape API can call out to a seperate auth service. So if you need to integrate an external auth system, you can.

<figure>
  <a href="/img/guides/auth/external-auth-service.jpg">
    <img src="/img/guides/auth/external-auth-service.png" class="hidden-sm"
        alt="Illustration of the proxied auth flow with an external auth service"
    />
    <img src="/img/guides/auth/external-auth-service.sm.png" class="block-sm"
        alt="Illustration of the proxied auth flow with an external auth service"
    />
  </a>
</figure>

## Alternative auth modes

We have a GitHub Discussions label for [auth feature requests](https://github.com/electric-sql/electric/discussions?discussions_q=label%3Aauth). This includes:

- [RLS support](https://github.com/electric-sql/electric/discussions/1587)
- [Token-based auth](https://github.com/electric-sql/electric/discussions/1674)

If you would like or need alternative strategies for auth, please upvote and/or contribute to the discussions there.
