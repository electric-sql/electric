---
title: 'AI agents as CRDT peers — building collaborative AI with Yjs'
description: >-
  How to build a collaborative AI editor where the AI agent is a server-side CRDT peer, using Durable Streams for both Yjs document sync and TanStack AI chat sessions.
excerpt: >-
  What if an AI agent could be a real-time CRDT peer? Where the agent has its own cursor, streams edits into a live Yjs document, and the whole thing runs on Durable Streams.
authors: [samwillis]
image: /img/blog/building-a-collaborative-ai-editor/header.jpg
imageWidth: 1536
imageHeight: 1024
tags: [durable-streams, yjs, agents, collaboration, tanstack-ai]
outline: [2, 3]
post: true
published: true
---

<style scoped>
  .embed-container {
    margin: 24px 0;
    border-radius: 2px;
    overflow: hidden;
  }
  .embed-container.top {
    margin: 32px 0 -12px 0;
  }
</style>

I came to sync engines through collaborative editing. Since AI agents became part of my daily workflow, I've had an earworm: what would it look like to integrate an AI agent into a Yjs rich text editing flow — not as a sidebar that dumps text, but as a real participant with its own cursor, presence, and streaming edits?

This post walks through how I built a [Collaborative AI Editor](https://collaborative-ai-editor.examples.electric-sql.com) demo — a [TanStack Start](https://tanstack.com/start) app with a [ProseMirror](https://prosemirror.net)/Yjs editor and an AI chat sidebar. It uses [Durable&nbsp;Streams](https://durablestreams.com) as the single transport layer for both [Yjs](https://yjs.dev) document collaboration and [TanStack&nbsp;AI](https://tanstack.com/ai) chat sessions. Two integrations, one primitive, and the AI becomes a genuine CRDT peer.

> [!Warning] Collaborative AI Editor demo
> Try the [live demo](https://collaborative-ai-editor.examples.electric-sql.com) and browse the [source code](https://github.com/electric-sql/collaborative-ai-editor).

<div class="embed-container top" style="padding-bottom: 56.25%">
  <YoutubeEmbed video-id="qdEIE5XY0wo" title="AI agents as CRDT peers: building a collaborative AI editor with Yjs" />
</div>

## The integration problem

AI-assisted writing and editing is everywhere — ChatGPT Canvas, Cursor, Notion AI all let an AI modify a document alongside you. Software engineers see this more clearly than most: we already have agents editing our code files daily. At the same time, real-time collaboration is table stakes. Google Docs and Figma taught users to expect multiplayer. The natural move is to treat an AI agent as just another peer in the same collaborative system.

But actually building that is painful. [Yjs](https://yjs.dev) has become the dominant toolkit for CRDT-based editors, and building a collaborative AI editor on top of it means integrating several separate real-time systems: CRDT sync for the document, token streaming for the AI, and presence/awareness, each with its own transport, persistence, and failure handling.

There's also a fundamental mismatch in how most AI writing tools approach editing. They generate a diff and patch the document as text. But a rich text CRDT is a data structure, not a string — you need to stream edits in as CRDT operations. And most approaches rely on client-side tool calls, which means the document has to be open in the user's browser for the agent to do anything.

Having worked on Durable&nbsp;Streams, then built the [Yjs integration](https://durablestreams.com/yjs), then the [TanStack&nbsp;AI integration](https://durablestreams.com/tanstack-ai), the natural question was: what if these two integrations shared the same infrastructure?

## Three streams, one primitive

[Durable&nbsp;Streams](https://durablestreams.com) is a persistent, addressable HTTP streaming protocol. Writers append data to a stream, subscribers consume it, and any client can catch up from its last offset at any time. The protocol handles reconnection and delivery automatically.

The Collaborative AI Editor uses three Durable&nbsp;Streams per document:

- **Yjs document** — the CRDT updates that make up the document, with the Durable&nbsp;Streams Yjs server handling persistence, compaction and GC
- **Yjs awareness** — cursor positions, selections, and presence of users and agents working on the document
- **TanStack&nbsp;AI chat** — the conversation between users and the AI agent

Two integrations make this work. The [`@durable-streams/y-durable-streams`](https://durablestreams.com/yjs) package wraps a standard `YjsProvider`, so the Yjs client doesn't know it's running over Durable&nbsp;Streams. You configure a single base URL and the provider manages both the document and awareness streams for you.

The [`@durable-streams/tanstack-ai-transport`](https://durablestreams.com/tanstack-ai) package provides a durable connection adapter for TanStack&nbsp;AI's `useChat` hook. Instead of the default request/response model where message state lives in the client, the adapter routes everything through a Durable&nbsp;Stream: user messages POST to your backend which writes them to the stream alongside the model's response chunks, and the client subscribes to that same stream. The chat session becomes persistent by default. Any client connecting to the same session picks up the full history and receives new messages in real-time.

Both integrations share the same underlying protocol. No WebSocket servers to manage, no separate persistence layer to build, no custom reconnection logic. For local development, `@durable-streams/server` runs with file-backed storage. In production, you can use [Durable&nbsp;Streams Cloud](https://durablestreams.com) or self-host.

<img src="/img/blog/building-a-collaborative-ai-editor/architecture.svg" alt="Architecture diagram showing the browser client and server agent both connecting to three Durable Streams: a Yjs document stream, a Yjs awareness stream, and a TanStack AI chat stream" />

## The AI as a CRDT peer

The key architectural choice: the AI agent is a server-side Yjs peer, not a client-side bolt-on. On the server, the agent opens its own Yjs document and connects to the same Durable Stream as the human editors. It's just another participant in the room. In the demo, the agent is called "Electra".

From the human user's perspective, Electra looks like any other collaborator:

- A visible cursor that moves through the document as the agent works
- Presence in the awareness bar, with status indicators: `thinking`, `composing`, `idle`
- Edits that appear in real-time through the same CRDT sync as everyone else's changes

The agent doesn't manipulate the Yjs document directly. It works through tool calls: the AI model decides what to do, a runtime on the server translates those tool calls into Yjs operations, and the CRDT sync propagates the changes to all connected clients. Because the agent is a server-side peer, it can edit the document whether or not any browser has it open.

<figure>
  <video class="w-full" autoplay loop muted playsinline preload="metadata">
    <source src="/videos/blog/building-a-collaborative-ai-editor/multiple-cursors.mp4" type="video/mp4" />
  </video>
  <figcaption>Electra's cursor and presence in the editor&nbsp;alongside&nbsp;a&nbsp;human&nbsp;user.</figcaption>
</figure>

```ts
async function createServerAgentSession(docKey: string, sessionId: string) {
  const ydoc = new Doc()
  const awareness = new Awareness(ydoc)

  // Set up the agent's presence — same awareness protocol as human users
  awareness.setLocalState({
    user: {
      name: 'Electra',
      color: '#7c3aed',
      role: 'agent',
      status: 'idle',
    },
  })

  // Connect to the same Durable Stream as the browser clients
  const provider = new YjsProvider({
    doc: ydoc,
    baseUrl: DURABLE_STREAMS_BASE_URL,
    docId: docKey,
    awareness,
  })
  await provider.connect()

  const fragment = ydoc.getXmlFragment('prosemirror')
  return { ydoc, awareness, provider, fragment, sessionId }
}
```

### Why server-side matters

Because the agent is a server-side peer, you can start an edit, close your laptop, and come back later to find the work done. And because it's editing through the CRDT, conflicts resolve naturally. If two humans and an agent are all editing simultaneously, Yjs merges everything without coordination.

> This also opens the door to asynchronous collaboration: an agent that can work on a document while you're away, with changes you review and merge later. Ink & Switch's [Patchwork](https://www.inkandswitch.com/project/patchwork/) project is exploring exactly this. More on async agent collaboration soon.

## Streaming edits into a live document

The hard problem here is that the AI generates markdown text, but the document is a rich text CRDT. It's a structured data type, not a string. You need to convert streaming markdown tokens into rich text nodes and insert them at positions that stay valid while other users are editing concurrently.

### Document tools

Modern AI models have been trained to use tool calls to interact with the outside world. We give the agent a set of tools for working with the document, and the core flow is **read → locate → edit**:

- **get_document_snapshot** reads a plain-text snapshot of the current document so the agent can see what's there before acting
- **search_text** finds exact text in the document and returns stable match handles with surrounding context. The agent uses this to locate its own insertion points based on its reading of the document, independent of where the user's cursor is
- **place_cursor** moves the agent's cursor to a match handle or to the start/end of the document, setting up the insertion point for the next edit
- **insert_text** inserts content at the agent's current cursor position
- **start_streaming_edit** arms the next edit for streaming into the document (see below)

There are additional tools for selection inspection, bulk replace, formatting, and deletion, but the important pattern is the search → place cursor → edit flow. The agent locates content by meaning, not by position. This works reliably under concurrent editing because the match handles are backed by Yjs relative positions.

The tool surface is deliberately constrained. The agent operates through the same kinds of editing actions a human would, not arbitrary document mutations. This makes it easier for the model to reason about what it's doing, and keeps the context window manageable by avoiding dumping the entire document into every request. Human editors see the edits arrive through CRDT sync like any other peer's changes.

### Routing streaming text into the document

Tool calls don't support async streaming. You call a tool with arguments and get a result back. But we want the model to stream prose into the document token by token.

The solution is a routing trick. `start_streaming_edit` is a tool that flips a switch: after it's called, the model's next text output gets intercepted and redirected into the document instead of streaming into the chat as an assistant message. The model just generates text naturally. The infrastructure decides where it goes.

`start_streaming_edit` takes a mode and a content format:

- **continue** or **insert** write at the agent's current cursor position
- **rewrite** replaces the current selection
- Content format can be **plain text** or **markdown**, which determines how the streaming text gets converted into document nodes (more on the markdown path [below](#streaming-markdown-into-the-document))

When the model finishes generating or calls another tool, the routing automatically stops. The model can also explicitly call `stop_streaming_edit` to switch back to chat output mid-turn. The system prompt explains this convention so the model knows to call `start_streaming_edit` before generating document prose, and to switch back when it wants to respond in the chat.

```ts
const searchTextDef = toolDefinition({
  name: 'search_text',
  description:
    'Search for exact text inside the document and return stable match handles.',
  inputSchema: z.object({
    query: z.string().min(1),
    maxResults: z.number().int().min(1).max(20).optional(),
  }),
})

const placeCursorDef = toolDefinition({
  name: 'place_cursor',
  description:
    'Place the agent cursor at the start or end of a previously returned match.',
  inputSchema: z.object({
    matchId: z.string().min(1),
    edge: z.enum(['start', 'end']).optional(),
  }),
})

const startStreamingEditDef = toolDefinition({
  name: 'start_streaming_edit',
  description:
    'Arm the next assistant text message for document insertion at the current '
    + 'cursor or selection. While active, output only document prose.',
  inputSchema: z.object({
    mode: z.enum(['continue', 'insert', 'rewrite']),
    contentFormat: z.enum(['plain_text', 'markdown']).optional(),
  }),
})
```

### Relative position anchors

Absolute positions in a document shift when other users type, making them useless for concurrent editing. [Yjs](https://docs.yjs.dev/api/relative-positions) solves this with relative positions, which are anchored to CRDT items rather than offsets. They stay correct regardless of what other users do to the document.

When the user sends a message, the client encodes its current cursor and selection as relative anchors and sends them to the server as part of the chat context. This gives the agent awareness of what the user is doing and where they're looking in the document. The agent doesn't have to use this context, but when the user says "rewrite this paragraph" or "insert something here", it can target the exact semantic position the user intended.

```ts
// Client: encode the cursor position as a Yjs relative position
const rel = absolutePositionToRelativePosition(cursorPos, fragment, mapping)
const anchorB64 = toBase64(Y.encodeRelativePosition(rel))

// Sent alongside the chat message as editorContext
// { kind: 'cursor', anchor: anchorB64 }
// or { kind: 'selection', anchor: anchorB64, head: headB64 }

// Server: decode the anchor on the agent's Y.Doc to get an absolute position
const rel = Y.decodeRelativePosition(fromBase64(anchorB64))
const absPos = relativePositionToAbsolutePosition(ydoc, fragment, rel, mapping)
// absPos is correct even if other users edited the document since encoding
```

### Streaming markdown into the document

The edits stream into the document in real-time. The user sees text appear as the AI generates it, just like watching another person type, and the agent's cursor moves through the document as it writes.

AI models have been trained on markdown as a native format. They naturally use it to express formatting and emphasis. Rather than fight against this by inventing a custom format or requiring tool calls for every formatting operation, we lean into markdown as an intermediate representation. A streaming pipeline incrementally parses the token stream and converts it into native Yjs document nodes as they arrive — `**bold**` becomes a bold mark, `## heading` becomes a heading node, `- item` becomes a list item. The model writes in the format it's best at, and the document receives properly structured rich text.

<figure>
  <video class="w-full" autoplay loop muted playsinline preload="metadata">
    <source src="/videos/blog/building-a-collaborative-ai-editor/markdown.mp4" type="video/mp4" />
  </video>
  <figcaption>Streaming markdown converted into rich text&nbsp;as&nbsp;the&nbsp;agent&nbsp;types.</figcaption>
</figure>

## Durable chat

The chat sidebar uses [TanStack&nbsp;AI](https://tanstack.com/ai)'s `useChat` hook with no custom component code. The only difference from a standard chat setup is the connection adapter: instead of the default request/response model, a durable connection routes messages through a Durable&nbsp;Stream. Messages POST to `/api/chat`, and the client subscribes to `/api/chat-stream`.

Because the chat session lives on a Durable&nbsp;Stream, it's resilient by default. Refresh the page mid-generation and the chat picks up where it left off. Close the tab entirely, come back later, and the full conversation history is there, including any generations that completed while you were away.

The chat and document streams are linked but independent. You can have the chat open without the editor, or vice versa.

```ts
import { durableStreamConnection } from '@durable-streams/tanstack-ai-transport'
import { useChat } from '@tanstack/ai-react'

const connection = durableStreamConnection({
  sendUrl: `/api/chat?docKey=${docKey}&sessionId=${sessionId}`,
  readUrl: `/api/chat-stream?docKey=${docKey}&sessionId=${sessionId}`,
})

// useChat works as normal — swap the connection adapter, everything else stays the same
const { messages, sendMessage, stop } = useChat({ connection })
```

### The agent response flow

When the user sends a message, the server runs TanStack&nbsp;AI's `chat()` with the document tools. The agent's text responses stream back through the durable chat stream to all subscribers.

When the agent calls a document tool, the edit is applied to the Yjs document and propagates through the Yjs Durable Stream. The tool result goes back through the chat Durable Stream. After making edits, the agent can stream a summary of what it changed back into chat, so the conversation log explains what happened even if you weren't watching the editor.

Cancellation is clean: stopping a generation tears down both the chat stream and any in-flight document edits. You can see this flow end-to-end in the [demo source code](https://github.com/electric-sql/collaborative-ai-editor).

<figure>
  <video class="w-full" autoplay loop muted playsinline preload="metadata">
    <source src="/videos/blog/building-a-collaborative-ai-editor/tool-calls.mp4" type="video/mp4" />
  </video>
  <figcaption>Chat sidebar showing tool call indicators as the agent edits&nbsp;the&nbsp;document.</figcaption>
</figure>

## Agents belong in the CRDT

The patterns in this demo aren't specific to rich text editors. Any application where an AI agent needs to collaborate on a shared data structure — a design file, a spreadsheet, a codebase — can use the same approach. Make the agent a CRDT peer, give it tools to read and edit the structure, and let the CRDT handle conflict resolution. The agent doesn't need special treatment. It's a participant.

Durable&nbsp;Streams makes this practical by collapsing document sync, presence, and chat into a single transport. The [Yjs integration](https://durablestreams.com/yjs) handles the CRDT layer. The [TanStack&nbsp;AI integration](https://durablestreams.com/tanstack-ai) handles the conversation. Both run over the same protocol, with the same resilience and reconnection guarantees, and no infrastructure to stitch together.

## Next steps

**Try it:**

- [Live demo](https://collaborative-ai-editor.examples.electric-sql.com) — open it in two tabs and chat with Electra
- [Source code](https://github.com/electric-sql/collaborative-ai-editor) — clone it, run it locally, and adapt it

**Learn more:**

- [Durable&nbsp;Streams + Yjs docs](https://durablestreams.com/yjs) and [Durable&nbsp;Streams + TanStack&nbsp;AI docs](https://durablestreams.com/tanstack-ai)
- Background posts: [Durable sessions for collaborative AI](/blog/2026/01/12/durable-sessions-for-collaborative-ai) and [Durable Transports for your AI&nbsp;SDK](/blog/2026/03/24/durable-transport-ai-sdks)
- [Yjs](https://yjs.dev), [TanStack&nbsp;AI](https://tanstack.com/ai), [ProseMirror](https://prosemirror.net)

**Build with it:**

- [Durable&nbsp;Streams Cloud](https://durablestreams.com) for hosted infrastructure
- [Reach out on Discord](https://discord.electric-sql.com) if you have questions or want help building something similar

