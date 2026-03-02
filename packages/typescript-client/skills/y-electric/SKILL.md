---
name: y-electric
description: >
  Yjs CRDT collaboration via Electric — ElectricProvider, Y.Doc, Awareness,
  ResumeState, LocalStorageResumeState, documentUpdates shape, awarenessUpdates
  shape, sendUrl, debounceMs, bytea parsing, CodeMirror integration
type: composition
library: '@electric-sql/client'
library_version: '1.5.8'
requires:
  - 'yjs'
  - '@electric-sql/y-electric'
  - 'y-protocols'
sources:
  - 'electric:packages/y-electric/src/y-electric.ts'
  - 'electric:examples/yjs'
---

# Y-Electric (Yjs Collaboration)

Real-time CRDT collaboration using Yjs synced through Electric.

## Setup

```bash
pnpm add yjs @electric-sql/y-electric y-protocols
```

## Core Patterns

### Basic ElectricProvider

```typescript
import * as Y from 'yjs'
import { ElectricProvider } from '@electric-sql/y-electric'
import { parseToDecoder } from '@electric-sql/y-electric/utils'

const doc = new Y.Doc()

const provider = new ElectricProvider({
  doc,
  documentUpdates: {
    shape: {
      url: '/shape-proxy/v1/shape',
      params: {
        table: 'ydoc_updates',
        where: `room = 'my-room'`,
      },
      parser: {
        bytea: parseToDecoder.bytea(),
      },
    },
    sendUrl: '/api/update',
    getUpdateFromRow: (row) => row.data,
  },
  debounceMs: 100,
})
```

### With Awareness (Cursor Positions, User Presence)

```typescript
import * as awarenessProtocol from 'y-protocols/awareness'

const awareness = new awarenessProtocol.Awareness(doc)

const provider = new ElectricProvider({
  doc,
  documentUpdates: {
    shape: {
      url: '/shape-proxy/v1/shape',
      params: { table: 'ydoc_updates', where: `room = 'my-room'` },
      parser: { bytea: parseToDecoder.bytea() },
      liveSse: true,
    },
    sendUrl: '/api/update',
    getUpdateFromRow: (row) => row.data,
  },
  awarenessUpdates: {
    shape: {
      url: '/shape-proxy/v1/shape',
      params: { table: 'ydoc_awareness', where: `room = 'my-room'` },
      parser: { bytea: parseToDecoder.bytea() },
      liveSse: true,
    },
    sendUrl: '/api/update',
    protocol: awareness,
    getUpdateFromRow: (row) => row.data,
  },
  debounceMs: 100,
})
```

### Resume State (Offline Persistence)

```typescript
import { LocalStorageResumeStateProvider } from '@electric-sql/y-electric'

const resumeStateProvider = new LocalStorageResumeStateProvider('my-room')

const provider = new ElectricProvider({
  doc,
  documentUpdates: {
    /* ... */
  },
  resumeState: resumeStateProvider.getResumeState(),
})

// Save resume state when it updates
provider.on('resumeState', (state) => {
  resumeStateProvider.save(state)
})
```

### Server-Side (Hono Example)

```typescript
import { Hono } from 'hono'

const app = new Hono()

// Save document updates
app.put('/api/update', async (c) => {
  const body = await c.req.arrayBuffer()
  const room = c.req.query('room')
  const clientId = c.req.query('client_id')

  await db.query('INSERT INTO ydoc_updates (room, data) VALUES ($1, $2)', [
    room,
    Buffer.from(body),
  ])
  return c.json({ ok: true })
})

// Shape proxy
app.get('/shape-proxy/v1/shape', async (c) => {
  const electricUrl = new URL(`${ELECTRIC_URL}/v1/shape`)
  // Forward params, set auth...
  const resp = await fetch(electricUrl)
  // Forward response with header cleanup
  return resp
})
```

### Database Schema

```sql
CREATE TABLE ydoc_updates (
  id SERIAL PRIMARY KEY,
  room TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ydoc_awareness (
  room TEXT NOT NULL,
  client_id INTEGER NOT NULL,
  data BYTEA NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room, client_id)
);
```

### Provider Events

```typescript
provider.on('synced', (synced: boolean) => {
  console.log('Sync status:', synced)
})

provider.on('status', ({ status }) => {
  console.log('Connection:', status) // "connected" | "disconnected" | "connecting"
})

provider.on('resumeState', (state) => {
  // Persist for offline resume
})
```

### Connect/Disconnect

```typescript
provider.disconnect() // pause sync
provider.connect() // resume sync
provider.destroy() // clean up completely
```

## Common Mistakes

### [HIGH] Not handling offline resume state

Wrong:

```typescript
const provider = new ElectricProvider({
  doc,
  documentUpdates: {
    shape: {
      /* ... */
    },
    sendUrl: '/api/update',
  },
})
// No resume state — full re-sync on every page load
```

Correct:

```typescript
const resumeState = new LocalStorageResumeStateProvider('room-id')

const provider = new ElectricProvider({
  doc,
  documentUpdates: {
    /* ... */
  },
  resumeState: resumeState.getResumeState(),
})

provider.on('resumeState', (state) => resumeState.save(state))
```

Without resume state persistence, the provider downloads the entire document
history on every connection. `LocalStorageResumeStateProvider` tracks the last
synced offset and state vector.

Source: packages/y-electric/src/local-storage-resume-state.ts

### [HIGH] Missing bytea parser for shape streams

Wrong:

```typescript
documentUpdates: {
  shape: {
    url: "/shape-proxy/v1/shape",
    params: { table: "ydoc_updates" },
    // No parser — bytea arrives as hex string, not decoder
  },
}
```

Correct:

```typescript
documentUpdates: {
  shape: {
    url: "/shape-proxy/v1/shape",
    params: { table: "ydoc_updates" },
    parser: { bytea: parseToDecoder.bytea() },
  },
}
```

Postgres `bytea` columns arrive as hex-encoded strings. The `parseToDecoder.bytea()`
parser converts them to the decoder format that `getUpdateFromRow` expects.

Source: packages/y-electric/src/utils.ts

### [MEDIUM] Not using debounce for high-frequency edits

Wrong:

```typescript
const provider = new ElectricProvider({
  doc,
  documentUpdates: {
    /* ... */
  },
  // debounceMs: 0 (default) — every keystroke sends an HTTP request
})
```

Correct:

```typescript
const provider = new ElectricProvider({
  doc,
  documentUpdates: {
    /* ... */
  },
  debounceMs: 100, // batch updates within 100ms window
})
```

Without debouncing, every Yjs document change triggers an immediate HTTP PUT.
With fast typing, this creates excessive requests. `debounceMs: 100` batches
updates using `Y.mergeUpdates`.

Source: packages/y-electric/src/y-electric.ts

## References

- [Yjs Documentation](https://docs.yjs.dev)
- [y-electric package](https://github.com/electric-sql/electric/tree/main/packages/y-electric)
- [yjs example](https://github.com/electric-sql/electric/tree/main/examples/yjs)
