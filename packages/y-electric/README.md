# Y-Electric

A [Yjs](https://yjs.dev) [provider](https://docs.yjs.dev/ecosystem/connection-provider) that enables real-time collaborative document editing using YJS, ElectricSQL and Postgres. It supports [Awareness](https://docs.yjs.dev/getting-started/adding-awareness) and can be used with any Yjs [database](https://docs.yjs.dev/ecosystem/database-provider) providers. See a full example [here](https://github.com/electric-sql/electric/tree/main/examples/yjs).

## How It Works

The typical flow for syncing shared documents using Yjs and Electric is the following:

1. Developer exposes a shape proxy for [authorizing](https://electric-sql.com/docs/guides/auth) shape requests
2. Clients define a [shape](https://electric-sql.com/docs/guides/shapes) for syncing changes for a [Y.Doc](https://docs.yjs.dev/api/y.doc)
3. Developer exposes a [write API](#Handling Writes) for handling Yjs updates
4. Voilà! Y-Electric automatically shares updates across all connected clients

### Key Features

### Basic Setup

```typescript
import * as Y from 'yjs'
import {
  ElectricProvider,
  LocalStorageResumeStateProvider,
} from '@electric-sql/y-electric'
import { Awareness } from 'y-protocols/awareness'
import { parseToDecoder } from '@electric-sql/y-electric/utils'

const ydoc = new Y.Doc()
const awareness = new Awareness(ydoc)
const resumeStateProvider = new LocalStorageResumeStateProvider('my-doc')

const provider = new ElectricProvider({
  doc: ydoc,
  documentUpdates: {
    shape: {
      url: SHAPE_PROXY_URL,
      params: {
        table: `ydoc_update`,
        where: `room = '${room}'`,
      },
      parser: parseToDecoder,
    },
    sendUrl: DOC_UPDATES_SEND_URL,
    getUpdateFromRow: (row) => row.op,
  },
  awarenessUpdates: {
    shape: {
      url: SHAPE_PROXY_URL,
      params: {
        table: `ydoc_awareness`,
        where: `room = '${room}'`,
      },
      parser: parseToDecoder,
    },
    sendUrl: AWARENESS_UPDATES_SEND_URL,
    protocol: awareness,
    getUpdateFromRow: (row) => row.op,
  },
  resumeState: resumeStateProvider.load(),
})

// Subscribe to resume state changes to persist them
resumeStateProvider.subscribeToResumeState(provider)
```

### Handling Writes

ElectricSQL is a read-path sync engine. This means that you bring your own API for handling document and awareness updates. See our sample server implementation [here](https://github.com/electric-sql/electric/blob/main/examples/yjs/server/server.ts). It's very easy!

#### Document Updates

Y-Electric sends YJS document updates as binary data. You can directly save the body of the request as a bytea column into the database.

```sql
-- Schema definition
CREATE TABLE ydoc_updates(
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    room text NOT NULL,
    op bytea NOT NULL
)
-- Save updates into individual rows
INSERT INTO ydoc_updates (room, op) VALUES ($1, $2)`
```

#### Awareness Updates

The awareness protocol implementation saves vector clock for each individual cliendId in separate rows:

Here is an example schema definition for ydoc_awareness:

```sql
-- Schema definitions
CREATE TABLE ydoc_awareness(
  client_id TEXT,
  room TEXT,
  op BYTEA NOT NULL,
  updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, room)
);
-- Save
INSERT INTO ydoc_awareness (room, client_id, op, updated) VALUES ($1, $2, $3, now())
         ON CONFLICT (client_id, room) DO UPDATE SET op = $3, updated = now()
```

It's recommended that you can garbage collect old client rows using a database trigger since the provider can't reliability detect when a client goes away:

```sql
CREATE OR REPLACE FUNCTION gc_awareness_timeouts()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM ydoc_awareness
    WHERE updated < (CURRENT_TIMESTAMP - INTERVAL '30 seconds') AND room = NEW.room;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER gc_awareness_timeouts_trigger
AFTER INSERT OR UPDATE ON ydoc_awareness
FOR EACH ROW
EXECUTE FUNCTION gc_awareness_timeouts();
```

### Schema mapping in the client

In the client, you need to pass a `getUpdateFromRow` to extract the column with the update binary. This allows Y-Electric to work with any backend schema.

### Storage providers

Y-Electric works with existing [database providers](https://docs.yjs.dev/ecosystem/database-provider) to store documents locally. When saving documents locally, we recommend providing a `ElectricResumeStateProvider` to save a resume point for the document, otherwise the entire document will be retransmitted when a new client session starts.
