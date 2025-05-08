# YJS Electric network provider

A [YJS](https://yjs.dev) provider that enables real-time collaborative document editing using ElectricSQL and Postgres.

## What is y-electric?

`y-electric` is a YJS [connection provider](https://docs.yjs.dev/ecosystem/connection-provider) that allows syncing YJS documents using ElectricSQL's sync engine. It leverages Postgres as the backend database for storing and syncing document updates and awareness states across users.

## How It Works

Y-Electric handles syncing over HTTP using ElectricSQL's sync engine

1. Updates made locally are pushed to the server and
   stored in Postgres using your API
2. ElectricSQL propagates updates across all connected clients using shapes
3. It has support for document and awareness updates

### Basic Setup

```typescript
import * as Y from "yjs"
import { ElectricProvider } from "@electric-sql/y-electric"
import { Awareness } from "y-protocols/awareness"
import { parseToDecoder } from "@electric-sql/y-electric/utils"

const ydoc = new Y.Doc()
const awareness = new Awareness(ydoc)

new ElectricProvider({
  doc: ydoc,
  documentUpdates: {
    shape: {
      url: SHAPE_PROXY_URL,
      params: {
        table: `ydoc_operations`,
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
```

### Backend implementation

ElectricSQL is a read-path sync engine. This means that you bring your own API for handling document and awareness updates.

#### Document Updates

Y-Electric sends yjs document updates as binary data. You can directly save the body of the request as a bytea column into your database.

```sql
INSERT INTO ydoc_operations (room, op) VALUES ($1, $2)`
```

```sql
-- schema definition
CREATE TABLE ydoc_operations (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    room text NOT NULL,
    op bytea NOT NULL
)
```

#### Awareness Updates

The awareness protocol implementation saves vector clock for each `awareness.clientID` in separate rows:

```sql
INSERT INTO ydoc_awareness (room, client_id, op) VALUES ($1, $2, $3)`
```

Here is an example schema definition for ydoc_awareness:

```sql
CREATE TABLE ydoc_awareness(
  client_id TEXT,
  room TEXT,
  op BYTEA NOT NULL,
  updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, room)
);
```

You can garbage collect old client rows using a database trigger:

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

In the client, you can use the optional `getUpdateFromRow` to extract the column with the actual yjs update for document and awareness updates.

### Storage providers

Y-Electric work with existing [database providers](https://docs.yjs.dev/ecosystem/database-provider). If you're using a persistence backend on the client, we recommend using the ElectricStorageProvider to save a resume point for the shapes, otherwise the entire document will be retransmitted when a new client session starts.

The ElectricStorageProvider also keeps track of the document state vector to handle offline updates.
