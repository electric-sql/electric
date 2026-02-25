---
name: electric-nextjs
description: >
  Next.js App Router integration — route.ts proxy handlers, NextRequest,
  ELECTRIC_PROTOCOL_QUERY_PARAMS, useShape, getShapeStream, matchStream,
  useOptimistic, content-encoding deletion, Vercel deployment, edge runtime
  SSE considerations, server components
type: composition
library: '@electric-sql/client'
library_version: '1.5.8'
requires:
  - 'next'
  - '@electric-sql/client'
  - '@electric-sql/react'
sources:
  - 'electric:examples/nextjs/app/shape-proxy/route.ts'
  - 'electric:examples/nextjs/app/page.tsx'
---

# Next.js + Electric

Next.js App Router integration with Electric shape proxy routes.

## Setup

```bash
pnpm add @electric-sql/client @electric-sql/react
```

## Core Patterns

### Proxy Route (App Router)

```typescript
// app/api/todos/route.ts (or app/shape-proxy/route.ts)
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const originUrl = new URL(
    `${process.env.ELECTRIC_URL || 'http://localhost:3000'}/v1/shape`
  )

  // Only forward Electric protocol params
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Server defines the shape
  originUrl.searchParams.set('table', 'items')

  // Electric Cloud auth (if configured)
  if (process.env.ELECTRIC_SOURCE_ID) {
    originUrl.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID)
  }
  if (process.env.ELECTRIC_SOURCE_SECRET) {
    originUrl.searchParams.set('secret', process.env.ELECTRIC_SOURCE_SECRET)
  }

  let resp = await fetch(originUrl.toString())

  // Remove encoding headers that break browser decoding
  if (resp.headers.get('content-encoding')) {
    const headers = new Headers(resp.headers)
    headers.delete('content-encoding')
    headers.delete('content-length')
    resp = new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    })
  }

  return resp
}
```

### Client Component with useShape

```tsx
'use client'

import { useShape } from '@electric-sql/react'

type Item = { id: string; title: string }

export default function ItemList() {
  const { data: items, isLoading } = useShape<Item>({
    url: `/api/todos`,
  })

  if (isLoading) return <p>Loading...</p>
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ul>
  )
}
```

### Optimistic Updates with React 19

```tsx
'use client'

import { useOptimistic } from 'react'
import { useShape, getShapeStream } from '@electric-sql/react'
import { matchStream } from './match-stream'

type Item = { id: string }

export default function Items() {
  const { data: items } = useShape<Item>({
    url: `/shape-proxy`,
  })

  const [optimisticItems, updateOptimistic] = useOptimistic(
    items,
    (state, { newId }: { newId: string }) => {
      const map = new Map(state.map((i) => [i.id, i]))
      map.set(newId, { id: newId })
      return Array.from(map.values())
    }
  )

  async function addItem(newId: string) {
    const stream = getShapeStream<Item>({ url: `/shape-proxy` })

    const findPromise = matchStream({
      stream,
      operations: ['insert'],
      matchFn: ({ message }) => message.value.id === newId,
    })

    const fetchPromise = fetch('/api/items', {
      method: 'POST',
      body: JSON.stringify({ uuid: newId }),
    })

    await Promise.all([findPromise, fetchPromise])
  }

  return (
    <form
      action={async (formData) => {
        const newId = formData.get('new-id') as string
        updateOptimistic({ newId })
        await addItem(newId)
      }}
    >
      <input type="hidden" name="new-id" value={crypto.randomUUID()} />
      <button type="submit">Add Item</button>
    </form>
  )
}
```

### Auth-Protected Proxy

```typescript
// app/api/todos/route.ts
import { auth } from '@/lib/auth'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${session.user.id}'`)

  return proxyElectricRequest(originUrl)
}
```

## Common Mistakes

### [HIGH] Using Pages Router API route patterns in App Router

Wrong:

```typescript
// pages/api/todos.ts (Pages Router — wrong for App Router)
export default function handler(req, res) {
  res.json({ data: [] })
}
```

Correct:

```typescript
// app/api/todos/route.ts (App Router)
export async function GET(request: Request) {
  return new Response(JSON.stringify({ data: [] }))
}
```

App Router uses `route.ts` with Web API `Request`/`Response`. Pages Router uses
`handler(req, res)`. These are incompatible API surfaces.

Source: Next.js documentation

### [MEDIUM] SSE on Vercel serverless (timeout)

Wrong:

```typescript
// Default serverless runtime — 10s timeout
export async function GET(request: Request) {
  // SSE connection will be killed by timeout
}
```

Correct:

```typescript
// Use edge runtime for long-lived connections
export const runtime = 'edge'

export async function GET(request: Request) {
  // Edge runtime has longer timeout for streaming
}
```

Vercel serverless functions have execution time limits. SSE streaming may not
work without edge runtime. The Electric client falls back to long-polling.

Source: Vercel documentation

### [HIGH] Not disabling Vercel CDN caching for Electric routes

Wrong:

```typescript
// No cache config — Vercel CDN may cache shape responses
```

Correct:

```json
{
  "headers": [
    {
      "source": "/api/electric/(.*)",
      "headers": [
        { "key": "CDN-Cache-Control", "value": "no-store" },
        { "key": "Vercel-CDN-Cache-Control", "value": "no-store" }
      ]
    }
  ]
}
```

Vercel's CDN caches responses and its cache keys may not differentiate between
offset/handle parameters. Stale responses break shape sync.

Source: website/docs/guides/troubleshooting.md

## References

- [Next.js App Router](https://nextjs.org/docs/app)
- [nextjs example](https://github.com/electric-sql/electric/tree/main/examples/nextjs)
- [Vercel Deployment](https://vercel.com/docs)
