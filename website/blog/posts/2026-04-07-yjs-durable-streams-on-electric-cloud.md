---
title: 'Yjs over HTTP on Durable Streams'
description: >-
  We've released a new Yjs provider built on Durable Streams — sync fan-out and fast catch-up from the edge for collaborative and agentic systems. Now live on Electric Cloud.
excerpt: >-
  We've released a new Yjs provider built on Durable Streams — sync fan-out and fast catch-up from the edge for collaborative and agentic systems. Now live on Electric Cloud.
authors: [balegas]
image: /img/blog/yjs-durable-streams-on-electric-cloud/header.png
tags: [durable-streams, cloud, release, sync, collaboration]
outline: [2, 3]
post: true
published: true
---

[Yjs](https://yjs.dev) is the de facto library for collaborative editing on the web — battle-proven, CRDT-based, and powering tools like [TipTap](https://tiptap.dev), [CodeMirror](https://codemirror.net), and [BlockNote](https://www.blocknotejs.org/). Today we're releasing [`y-durable-streams`](https://www.npmjs.com/package/@durable-streams/y-durable-streams) — a new Yjs provider built on [Durable&nbsp;Streams](/primitives/durable-streams), now live on [Electric&nbsp;Cloud](/cloud). It brings built-in persistence, compaction, and real-time presence to collaborative apps and agentic&nbsp;systems.

>[!info] 🚀&nbsp; Try it now
>[Create a Yjs service](https://dashboard.electric-sql.cloud/?intent=create&serviceType=yjs), see the [integration docs](https://durablestreams.com/yjs), [source&nbsp;code](https://github.com/durable-streams/durable-streams/tree/main/packages/y-durable-streams), and [demo&nbsp;app](/demos/territory-wars).

## Yjs on Durable Streams

[Durable&nbsp;Streams](/primitives/durable-streams) is an open HTTP protocol for persistent, resumable, real-time streams. Data is durably stored, synced over plain HTTP, and cacheable at the&nbsp;edge.

Most Yjs setups rely on WebSocket relay servers that maintain persistent point-to-point connections to sync changes to clients in real time. As agentic systems bring more participants into collaborative documents, they challenge the scalability of these&nbsp;setups.

Durable Streams use a fan-out architecture for syncing changes in real time. Write changes to a log once and sync them via an edge cache or CDN to any number of connected&nbsp;clients.

## How it works

Every document (CRDT) is backed by its own durable stream — a persistent, append-only log. You POST edits to the stream and subscribe to real-time updates via SSE or long-polling. This is the primary channel for syncing live changes to connected&nbsp;clients.

As updates accumulate, the protocol compacts them into **snapshots** — immutable, point-in-time representations of the document. When a new client opens the document, it fetches the latest snapshot. As new snapshots are generated, the protocol directs clients to the latest one and garbage-collects old&nbsp;ones.

Presence information flows through dedicated **awareness streams**, separate from the document stream. Awareness data is ephemeral, so these streams have a built-in TTL that automatically cleans them up when there are no active clients.

For the full details, see the [Yjs Durable Streams Protocol](https://github.com/durable-streams/durable-streams/blob/main/packages/y-durable-streams/YJS-PROTOCOL.md)&nbsp;specification.

## Demo

Try [Territory Wars](/demos/territory-wars) — a multiplayer territory capture game running `y-durable-streams` live on Electric&nbsp;Cloud. The game board is a Yjs Y.Map where each cell is a last-writer-wins register. Players move to claim cells and enclose territory. Player presence is tracked via awareness streams. Game state is managed via [StreamDB](/blog/2026/03/26/stream-db).

<div class="embed-container">
  <YoutubeEmbed video-id="r3i25BGom0s" />
</div>

## Get started

Here's how to set up a collaborative text editor — create a Yjs document with awareness and point it at your&nbsp;endpoint:

```typescript
import { YjsProvider } from '@durable-streams/y-durable-streams'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

const doc = new Y.Doc()
const awareness = new Awareness(doc)

const provider = new YjsProvider({
  doc,
  awareness,
  baseUrl: 'https://api.electric-sql.cloud/v1/stream/svc-your-service',
  docId: 'my-document',
})
```

Then wire it into your editor. Here's an example with&nbsp;TipTap:

```typescript
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false }),
    Collaboration.configure({ document: doc }),
    CollaborationCursor.configure({ provider }),
  ],
})
```

The provider handles sync, compaction, and awareness. Cursors, selections, and user presence work out of the box — every client that connects to the same `docId` sees the same document, in real&nbsp;time.

Clone the [demo&nbsp;app](https://github.com/durable-streams/durable-streams/tree/main/examples/yjs-demo) to see a working example, or drop the provider into your existing Yjs&nbsp;project.

## No lock-in

The entire protocol is [documented](https://github.com/durable-streams/durable-streams/blob/main/packages/y-durable-streams/YJS-PROTOCOL.md) and ships with a conformance test suite you can run against any implementation. Self-host it, switch providers, or build your own compatible server — your documents are&nbsp;yours.

Electric Cloud implements the protocol faithfully — no proprietary extensions, no vendor-specific APIs. It's the fastest way to get&nbsp;started.

## Next steps

- [Create a Yjs service](https://dashboard.electric-sql.cloud/?intent=create&serviceType=yjs) on Electric Cloud
- [Integration docs](https://durablestreams.com/yjs) and [protocol spec](https://github.com/durable-streams/durable-streams/blob/main/packages/y-durable-streams/YJS-PROTOCOL.md)
- [Territory Wars demo](/demos/territory-wars) and [collaborative editor example](https://github.com/durable-streams/durable-streams/tree/main/examples/yjs-demo) on GitHub

Join us on [Discord](https://discord.electric-sql.com) with any&nbsp;questions.
