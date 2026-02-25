---
name: electric-testing
description: >
  Testing Electric apps — unit testing with mocked fetchClient, vi.fn(),
  ShapeStream mock, integration testing with real Electric + Postgres + nginx,
  Docker services, pnpm test, vitest patterns
type: sub-skill
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:AGENTS.md'
---

# Electric Testing Patterns

Unit tests mock the fetch layer. Integration tests run against real Electric +
Postgres.

## Setup

```bash
pnpm add -D vitest
```

## Core Patterns

### Unit Testing (Mocked Fetch)

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ShapeStream, Shape } from '@electric-sql/client'

describe('todo sync', () => {
  it('creates shape stream with correct URL', () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            key: '1',
            value: { id: '1', text: 'Test' },
            headers: { operation: 'insert' },
          },
          { headers: { control: 'up-to-date' } },
        ]),
        {
          headers: {
            'electric-handle': 'test-handle',
            'electric-offset': '0_0',
          },
        }
      )
    )

    const stream = new ShapeStream({
      url: '/api/todos',
      fetchClient: mockFetch,
    })

    expect(mockFetch).toHaveBeenCalled()
    const calledUrl = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain('/api/todos')
  })
})
```

### Mocking Collection Shape Options

```typescript
const testCollection = createCollection(
  electricCollectionOptions({
    id: 'test-todos',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: '/api/todos',
      fetchClient: vi.fn(), // prevents real HTTP calls
    },
    onInsert: async ({ transaction }) => {
      return { txid: '1' } // mock txid
    },
  })
)
```

### Integration Testing (Real Services)

**Step 1 — Start Docker services:**

```bash
# Start Postgres, Electric, and nginx
cd packages/sync-service/dev
ELECTRIC_IMAGE=electricsql/electric:canary \
  docker compose -f docker-compose.yml -f docker-compose-electric.yml \
  up --wait postgres electric nginx
```

Services:

- PostgreSQL: `localhost:54321`
- Electric API: `http://localhost:3000`
- Nginx proxy: `http://localhost:3002`

**Step 2 — Run tests:**

```bash
cd packages/typescript-client
pnpm test              # watch mode
pnpm test --run        # single run
pnpm test -t "pattern" # filter by name
```

**Step 3 — Teardown:**

```bash
cd packages/sync-service/dev
docker compose -f docker-compose.yml -f docker-compose-electric.yml down
```

### Testing Proxy Routes

```typescript
import { describe, it, expect } from 'vitest'

describe('proxy route', () => {
  it('returns 401 without auth', async () => {
    const response = await fetch('/api/todos')
    expect(response.status).toBe(401)
  })

  it('sets table server-side', async () => {
    const mockElectric = vi.fn().mockResolvedValue(new Response('[]'))
    // Verify the proxy sets table=todos, not from client
  })

  it('forwards Electric protocol params', async () => {
    const response = await fetch('/api/todos?offset=0_0&handle=abc&live=true')
    // Verify offset, handle, live are forwarded
  })

  it('strips client table/where params', async () => {
    const response = await fetch('/api/todos?table=users&where=1=1')
    // Verify table and where from client are ignored
  })
})
```

## Common Mistakes

### [MEDIUM] Not mocking fetchClient for unit tests

Wrong:

```typescript
const stream = new ShapeStream({ url: '/api/todos' })
// Hits real Electric server — flaky, slow, requires infra
```

Correct:

```typescript
const stream = new ShapeStream({
  url: '/api/todos',
  fetchClient: vi.fn().mockResolvedValue(
    new Response('[]', {
      headers: { 'electric-handle': 'h', 'electric-offset': '0_0' },
    })
  ),
})
```

Without a mock, unit tests require a running Electric server. Use
`shapeOptions.fetchClient = vi.fn()` for isolated tests.

Source: AGENTS.md Testing section

### [MEDIUM] Building local Electric image when not needed

Wrong:

```bash
# Always building from source (slow, 5+ minutes)
docker build -t electric-local -f packages/sync-service/Dockerfile ...
```

Correct:

```bash
# Use canary image when your changes are client-only
export ELECTRIC_IMAGE=electricsql/electric:canary
docker compose up --wait postgres electric nginx
```

Only build locally when working on branches that change the sync service.
Client-only changes can use the canary image.

Source: AGENTS.md Integration testing section

### [HIGH] Not testing proxy auth enforcement

Wrong:

```typescript
// Only testing happy path
it('returns data when authenticated', async () => {
  const res = await fetch('/api/todos', { headers: { Authorization: '...' } })
  expect(res.ok).toBe(true)
})
```

Correct:

```typescript
it('returns 401 without auth', async () => {
  const res = await fetch('/api/todos')
  expect(res.status).toBe(401)
})

it('returns 403 for wrong user', async () => {
  const res = await fetch('/api/todos', {
    headers: { Authorization: `Bearer ${otherUserToken}` },
  })
  expect(res.status).toBe(403)
})
```

Security proxy routes must be tested for rejection, not just acceptance.

Source: AGENTS.md Security Rules

## References

- [Vitest Documentation](https://vitest.dev)
- [TypeScript Client API](https://electric-sql.com/docs/api/clients/typescript)
