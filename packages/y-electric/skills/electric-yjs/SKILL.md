---
name: electric-yjs
description: >
  Set up ElectricProvider for real-time collaborative editing with Yjs via
  Electric shapes. Covers ElectricProvider configuration, document updates
  shape with BYTEA parser (parseToDecoder), awareness shape at offset='now',
  LocalStorageResumeStateProvider for reconnection with stableStateVector
  diff, debounceMs for batching writes, sendUrl PUT endpoint, required
  Postgres schema (ydoc_update and ydoc_awareness tables), CORS header
  exposure, and sendErrorRetryHandler. Load when implementing collaborative
  editing with Yjs and Electric.
type: composition
library: electric
library_version: '0.1.36'
requires:
  - electric-shapes
sources:
  - 'electric-sql/electric:packages/y-electric/src/y-electric.ts'
  - 'electric-sql/electric:packages/y-electric/src/types.ts'
  - 'electric-sql/electric:packages/y-electric/src/local-storage-resume-state.ts'
  - 'electric-sql/electric:packages/y-electric/src/utils.ts'
  - 'electric-sql/electric:examples/yjs/'
---

This skill builds on electric-shapes. Read it first for ShapeStream configuration.

# Electric — Yjs Collaboration

## Setup

### 1. Create Postgres tables

```sql
CREATE TABLE ydoc_update (
  id SERIAL PRIMARY KEY,
  room TEXT NOT NULL,
  update BYTEA NOT NULL
);

CREATE TABLE ydoc_awareness (
  client_id TEXT,
  room TEXT,
  update BYTEA NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, room)
);

-- Garbage collect stale awareness entries
CREATE OR REPLACE FUNCTION gc_awareness_timeouts()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM ydoc_awareness
  WHERE updated_at < (CURRENT_TIMESTAMP - INTERVAL '30 seconds')
    AND room = NEW.room;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER gc_awareness
  AFTER INSERT OR UPDATE ON ydoc_awareness
  FOR EACH ROW EXECUTE FUNCTION gc_awareness_timeouts();
```

### 2. Create server endpoint for receiving updates

```ts
// PUT /api/yjs/update — receives binary Yjs update
app.put('/api/yjs/update', async (req, res) => {
  const body = Buffer.from(await req.arrayBuffer())
  await db.query('INSERT INTO ydoc_update (room, update) VALUES ($1, $2)', [
    req.headers['x-room-id'],
    body,
  ])
  res.status(200).end()
})
```

### 3. Configure ElectricProvider

```ts
import * as Y from 'yjs'
import {
  ElectricProvider,
  LocalStorageResumeStateProvider,
  parseToDecoder,
} from '@electric-sql/y-electric'

const ydoc = new Y.Doc()
const roomId = 'my-document'

const resumeProvider = new LocalStorageResumeStateProvider(roomId)

const provider = new ElectricProvider({
  doc: ydoc,
  documentUpdates: {
    shape: {
      url: `/api/yjs/doc-shape?room=${roomId}`,
      parser: parseToDecoder,
    },
    sendUrl: '/api/yjs/update',
    getUpdateFromRow: (row) => row.update,
  },
  awarenessUpdates: {
    shape: {
      url: `/api/yjs/awareness-shape?room=${roomId}`,
      parser: parseToDecoder,
      offset: 'now', // Only live awareness, no historical backfill
    },
    sendUrl: '/api/yjs/awareness',
    protocol: provider.awareness,
    getUpdateFromRow: (row) => row.update,
  },
  resumeState: resumeProvider.load(),
  debounceMs: 100, // Batch rapid edits
})

// Persist resume state for efficient reconnection
resumeProvider.subscribeToResumeState(provider)
```

## Core Patterns

### CORS headers for Yjs proxy

```ts
// Proxy must expose Electric headers
const corsHeaders = {
  'Access-Control-Expose-Headers':
    'electric-offset, electric-handle, electric-schema, electric-cursor',
}
```

### Resume state for reconnection

```ts
// On construction, pass stored resume state
const provider = new ElectricProvider({
  doc: ydoc,
  documentUpdates: { shape: shapeOpts, sendUrl: '/api/yjs/update' },
  resumeState: resumeProvider.load(),
})

// Subscribe to persist updates
const unsub = resumeProvider.subscribeToResumeState(provider)

// Clean up
provider.destroy()
unsub()
```

When `stableStateVector` is provided in resume state, the provider sends only the diff between the stored vector and current doc state on reconnect.

### Connection lifecycle

```ts
provider.on('status', ({ status }) => {
  // 'connecting' | 'connected' | 'disconnected'
  console.log('Yjs sync status:', status)
})

provider.on('sync', (synced: boolean) => {
  console.log('Document synced:', synced)
})

// Manual disconnect/reconnect
provider.disconnect()
provider.connect()
```

## Common Mistakes

### HIGH Not persisting resume state for reconnection

Wrong:

```ts
const provider = new ElectricProvider({
  doc: ydoc,
  documentUpdates: {
    shape: { url: '/api/yjs/doc-shape', parser: parseToDecoder },
    sendUrl: '/api/yjs/update',
    getUpdateFromRow: (row) => row.update,
  },
})
```

Correct:

```ts
const resumeProvider = new LocalStorageResumeStateProvider('my-doc')
const provider = new ElectricProvider({
  doc: ydoc,
  documentUpdates: {
    shape: { url: '/api/yjs/doc-shape', parser: parseToDecoder },
    sendUrl: '/api/yjs/update',
    getUpdateFromRow: (row) => row.update,
  },
  resumeState: resumeProvider.load(),
})
resumeProvider.subscribeToResumeState(provider)
```

Without `resumeState`, the provider fetches the ENTIRE document shape on every reconnect. With `stableStateVector`, only a diff is sent.

Source: `packages/y-electric/src/types.ts:102-112`

### HIGH Missing BYTEA parser for shape streams

Wrong:

```ts
documentUpdates: {
  shape: { url: '/api/yjs/doc-shape' },
  sendUrl: '/api/yjs/update',
  getUpdateFromRow: (row) => row.update,
}
```

Correct:

```ts
import { parseToDecoder } from '@electric-sql/y-electric'

documentUpdates: {
  shape: {
    url: '/api/yjs/doc-shape',
    parser: parseToDecoder,
  },
  sendUrl: '/api/yjs/update',
  getUpdateFromRow: (row) => row.update,
}
```

Yjs updates are stored as BYTEA in Postgres. Without `parseToDecoder`, the shape returns raw hex strings instead of lib0 Decoders, and `Y.applyUpdate` fails silently or corrupts the document.

Source: `packages/y-electric/src/utils.ts`

### MEDIUM Not setting debounceMs for collaborative editing

Wrong:

```ts
const provider = new ElectricProvider({
  doc: ydoc,
  documentUpdates: { shape: shapeOpts, sendUrl: '/api/yjs/update' },
  // Default debounceMs = 0: every keystroke sends a PUT
})
```

Correct:

```ts
const provider = new ElectricProvider({
  doc: ydoc,
  documentUpdates: { shape: shapeOpts, sendUrl: '/api/yjs/update' },
  debounceMs: 100,
})
```

Default `debounceMs` is 0, sending a PUT request for every keystroke. Set to 100+ to batch rapid edits and reduce server load.

Source: `packages/y-electric/src/y-electric.ts`

See also: electric-shapes/SKILL.md — Shape configuration and parser setup.

## Version

Targets @electric-sql/y-electric v0.1.x.
