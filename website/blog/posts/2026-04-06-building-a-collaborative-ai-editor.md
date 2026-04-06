---
title: 'AI agents as CRDT peers: building a collaborative AI editor with Yjs'
description: >-
  How to build a collaborative AI editor where the AI agent is a server-side CRDT peer, using Durable Streams for both Yjs document sync and TanStack AI chat sessions.
excerpt: >-
  What if an AI agent could join a collaborative document as a real-time CRDT peer? This post walks through building an editor where the agent has its own cursor, streams edits into a live Yjs document, and the whole thing runs on Durable Streams.
authors: [samwillis]
image: /img/blog/building-a-collaborative-ai-editor/header.jpg
imageWidth: 1536
imageHeight: 1024
tags: [durable-streams, yjs, agents, collaboration, tanstack-ai]
outline: [2, 3]
post: true
published: true
---

<!-- TLDR: State the point immediately. No setup, no preamble. Technical
     audience wants to know what this is and why it matters in under
     10 seconds. -->

I came to sync engines through collaborative editing. Since AI agents became part of my daily workflow, I've had an earworm: what would it look like to integrate an AI agent into a Yjs rich text editing flow — not as a sidebar that dumps text, but as a real participant with its own cursor, presence, and streaming edits?

This post walks through how I built a [Collaborative AI Editor](https://collaborative-ai-editor.examples.electric-sql.com) demo — a TanStack Start app with a ProseMirror/Yjs editor and an AI chat sidebar — using [Durable&nbsp;Streams](https://durablestreams.com) as the single transport layer for both [Yjs](https://yjs.dev) document collaboration and [TanStack&nbsp;AI](https://tanstack.com/ai) chat sessions. Two integrations, one primitive, and the AI becomes a genuine CRDT peer.

> [!Warning] Collaborative AI Editor demo
> Try the [live demo](https://collaborative-ai-editor.examples.electric-sql.com) and browse the [source code](https://github.com/electric-sql/collaborative-ai-editor).

<!-- ASSET: Video embed of the full demo experience -->

> **ASSET:** Video embed of the full demo experience

<!-- SITUATION: Head-nodding statements. The reader already believes these
     things. Establish shared reality — no persuasion, just recognition.
     Sam's personal context grounds this in lived experience, not theory. -->

## The obvious intersection

AI-assisted writing and editing is everywhere. ChatGPT Canvas, Cursor, Notion AI all let an AI modify a document alongside you. Software engineers see this more clearly than most: we already have agents editing our code files daily, working alongside us in the same codebase.

At the same time, real-time collaboration is table stakes for productivity tools. Google Docs taught a generation of users to expect it, and Figma proved the model works for complex creative tools too. If you're building anything where people work on shared artifacts, multiplayer is the baseline.

The intersection is obvious. We already have the tools for multiple people to edit a document together in real-time. If we treat an AI agent as just another peer in that system, we get collaborative AI editing without reinventing the wheel. The agent joins the same document, gets its own cursor, and edits alongside you using the same CRDT infrastructure that already handles conflict resolution between humans.

<!-- COMPLICATION: Introduce tension. The reader should feel "yes, that's
     my problem." This is grounded in what Sam actually encountered and
     observed — not theoretical concerns. The diff/patch vs CRDT structure
     point is the sharpest technical hook. -->

## But the integration is painful

The technology for building collaborative editors has evolved. Earlier editors like Google Docs used operational transforms (OT), which require a central server to resolve conflicts. CRDTs removed that constraint, and [Yjs](https://yjs.dev) has become the dominant toolkit for building CRDT-based editors today. But building a collaborative AI editor on top of Yjs means integrating several separate real-time systems: CRDT sync for the document, token streaming for the AI, and presence/awareness, each with its own transport, connection lifecycle, persistence, and failure handling.

There's also a fundamental mismatch in how most AI writing tools approach document editing. They generate a diff and patch the document as markdown or plain text. But a rich text document built on CRDTs is a data structure, not a string. You need to stream edits in as CRDT operations, not text patches.

On top of that, most approaches rely on client-side tool calls to edit the document, which means the document has to be open in the user's browser for the agent to do anything. A server-side agent that edits the CRDT directly doesn't have that limitation.

Put it all together and you're looking at one protocol for Yjs, another for AI streaming, custom persistence for chat history, and separate reconnection logic for each layer. Every system fails independently. It's a lot of moving parts for something that should feel simple.

<!-- STYLE: The transition from complication to answer should feel natural —
     Sam worked on Durable Streams, then the Yjs integration, then the
     TanStack AI integration. Gluing them together was the obvious next step. -->

Having worked on Durable&nbsp;Streams, then built the [Yjs integration](https://durablestreams.com/yjs), then the [TanStack&nbsp;AI integration](https://durablestreams.com/tanstack-ai), the natural question was: what if these two integrations shared the same infrastructure?

<!-- ANSWER SECTIONS: Each ## is a component of the answer. Order by
     importance. Show, don't tell — code and examples over assertions. -->

## Three streams, one primitive

<!-- This section establishes the architectural foundation. The reader
     should understand the "shape" of the system before diving into
     specifics. Keep it concrete — what are the three streams, how do
     they connect. -->

[Durable&nbsp;Streams](https://durablestreams.com) is a persistent, addressable HTTP streaming protocol. Writers append data to a stream, subscribers consume it, and any client can catch up from its last offset at any time. The protocol handles reconnection and delivery automatically.

The Collaborative AI Editor uses three Durable&nbsp;Streams per document:

- **Yjs document** — the CRDT updates that make up the document, with the Durable&nbsp;Streams Yjs server handling persistence, compaction and GC
- **Yjs awareness** — cursor positions, selections, and presence of users and agents working on the document
- **TanStack&nbsp;AI chat** — the conversation between users and the AI agent

Two integrations make this work. The [`@durable-streams/y-durable-streams`](https://durablestreams.com/yjs) package wraps a standard `YjsProvider`, so the Yjs client doesn't know it's running over Durable&nbsp;Streams. You configure a single base URL and the provider manages both the document and awareness streams for you.

The [`@durable-streams/tanstack-ai-transport`](https://durablestreams.com/tanstack-ai) package provides a durable connection adapter for TanStack&nbsp;AI's `useChat` hook. Instead of the default request/response model where message state lives in the client, the adapter routes everything through a Durable&nbsp;Stream: user messages POST to your backend which writes them to the stream alongside the model's response chunks, and the client subscribes to that same stream. The chat session becomes persistent by default. Any client connecting to the same session picks up the full history and receives new messages in real-time.

Both integrations share the same underlying protocol. No WebSocket servers to manage, no separate persistence layer to build, no custom reconnection logic. For local development, `@durable-streams/server` runs with file-backed storage. In production, you use Durable&nbsp;Streams Cloud or self-host.

<!-- ASSET: Architecture diagram showing the three durable streams (Yjs doc,
     Yjs awareness, AI chat) flowing through the same Durable Streams
     infrastructure to the browser and server agent -->

<!-- TODO: swap with SVG -->

```
 ┌─────────────────────┐              ┌──────────────────────┐
 │   Browser Client    │              │    Server Agent      │
 │                     │              │    ("Electra")       │
 │  ┌───────────────┐  │              │                      │
 │  │  ProseMirror  │  │              │  ┌────────────────┐  │
 │  │  + Yjs Editor │  │              │  │  Server Y.Doc  │  │
 │  └───────┬───────┘  │              │  └───────┬────────┘  │
 │          │          │              │          │           │
 │  ┌───────┴───────┐  │              │  ┌───────┴────────┐  │
 │  │  YjsProvider  │  │              │  │  YjsProvider   │  │
 │  └───┬───────┬───┘  │              │  └──┬────────┬────┘  │
 │      │       │      │              │     │        │       │
 │  ┌───┴───┐   │      │              │     │   ┌────┴────┐  │
 │  │useChat│   │      │              │     │   │  chat() │  │
 │  └───┬───┘   │      │              │     │   └────┬────┘  │
 └──────┼───────┼──────┘              └─────┼────────┼───────┘
        │       │                           │        │
        │       │    Durable Streams        │        │
 ───────┼───────┼───────────────────────────┼────────┼────────
        │       │                           │        │
   ┌────┴───────┴───────────────────────────┴────────┴─────┐
   │                                                       │
   │  ┌─────────────────────────────────────────────────┐  │
   │  │  Stream: /doc/{id}/yjs          (Yjs document)  │  │
   │  └─────────────────────────────────────────────────┘  │
   │  ┌─────────────────────────────────────────────────┐  │
   │  │  Stream: /doc/{id}/yjs/awareness (Yjs awareness)│  │
   │  └─────────────────────────────────────────────────┘  │
   │  ┌─────────────────────────────────────────────────┐  │
   │  │  Stream: /doc/{id}/chat         (TanStack AI)   │  │
   │  └─────────────────────────────────────────────────┘  │
   │                                                       │
   │              Durable Streams Server                   │
   └───────────────────────────────────────────────────────┘
```

## The AI as a CRDT peer

<!-- The key architectural decision. The reader should understand WHY
     server-side matters, not just that it's server-side. The contrast
     with client-side tool calls is the hook. -->

The key architectural choice: the AI agent is a server-side Yjs peer, not a client-side bolt-on. On the server, the agent opens its own Yjs document and connects to the same Durable Stream as the human editors. It's just another participant in the room. In the demo, the agent is called "Electra".

From the human user's perspective, Electra looks like any other collaborator:

- A visible cursor that moves through the document as the agent works
- Presence in the awareness bar, with status indicators: `thinking`, `composing`, `idle`
- Edits that appear in real-time through the same CRDT sync as everyone else's changes

The agent doesn't manipulate the Yjs document directly. It works through tool calls: the AI model decides what to do, a runtime on the server translates those tool calls into Yjs operations, and the CRDT sync propagates the changes to all connected clients. Because the agent is a server-side peer, it can edit the document whether or not any browser has it open.

<!-- ASSET: Screenshot or short video showing Electra's cursor and
     presence in the editor alongside a human user -->

> **ASSET:** Screenshot or short video — Electra's cursor and presence in the editor alongside a human user

<!-- ASSET: Short code snippet — createServerAgentSession setup or
     awareness config -->

```ts
function createServerAgentSession(docKey: string, sessionId: string) {
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

> There's a lot to explore at the intersection of synchronous and asynchronous collaboration with AI agents. When the agent is a CRDT peer, it can work on a branch of the document while you're away, and you can review and merge its changes later. Ink & Switch's [Patchwork](https://www.inkandswitch.com/project/patchwork/) project is doing fascinating research in this space, bringing version control concepts like branches and diffs to writing and creative work. I'm going to write more on this soon.

## Streaming edits into a live document

<!-- This is the most technically dense section. The reader needs to
     understand the problem (you can't just append characters one at a
     time to a CRDT) before the solution makes sense. Walk through
     the techniques in logical order: tools → anchors → commits → markdown. -->

The hard problem here is that the AI generates markdown text, but the document is a rich text CRDT. It's a structured data type, not a string. You need to convert streaming markdown tokens into rich text nodes and insert them at positions that stay valid while other users are editing concurrently.

### Document tools

<!-- The tool surface defines the contract between the AI model and the
     document. Emphasise that it's deliberately constrained — the agent
     edits like a collaborator, not an omnipotent mutator. -->

Modern AI models have been trained to use tool calls to interact with the outside world. We give the agent a set of tools for working with the document, and the core flow is **read → locate → edit**:

- **get_document_snapshot** reads a plain-text snapshot of the current document so the agent can see what's there before acting
- **search_text** finds exact text in the document and returns stable match handles with surrounding context. The agent uses this to locate its own insertion points based on its reading of the document, independent of where the user's cursor is
- **place_cursor** moves the agent's cursor to a match handle or to the start/end of the document, setting up the insertion point for the next edit
- **insert_text** inserts content at the agent's current cursor position
- **start_streaming_edit** arms the next edit for streaming into the document (see below)

There are additional tools for selection inspection, bulk replace, formatting, and deletion, but the important pattern is the search → place cursor → edit flow. The agent locates content by meaning, not by position. This works reliably under concurrent editing because the match handles are backed by Yjs relative positions.

The tool surface is deliberately constrained. The agent operates through the same kinds of editing actions a human would, not arbitrary document mutations. This makes it easier for the model to reason about what it's doing, and keeps the context window manageable by avoiding dumping the entire document into every request. Human editors see the edits arrive through CRDT sync like any other peer's changes.

### Routing streaming text into the document

<!-- This is one of the most interesting implementation details. It
     deserves its own subsection because it solves a real limitation
     of tool-based AI architectures. -->

Tool calls don't support async streaming. You call a tool with arguments and get a result back. But we want the model to stream prose into the document token by token.

The solution is a routing trick. `start_streaming_edit` is a tool that flips a switch: after it's called, the model's next text output gets intercepted and redirected into the document instead of streaming into the chat as an assistant message. The model just generates text naturally. The infrastructure decides where it goes.

`start_streaming_edit` takes a mode and a content format:

- **continue** or **insert** write at the agent's current cursor position
- **rewrite** replaces the current selection
- Content format can be **plain text** or **markdown**, which determines how the streaming text gets converted into document nodes (more on the markdown path [below](#streaming-markdown-into-the-document))

When the model finishes generating or calls another tool, the routing automatically stops. The model can also explicitly call `stop_streaming_edit` to switch back to chat output mid-turn. The system prompt explains this convention so the model knows to call `start_streaming_edit` before generating document prose, and to switch back when it wants to respond in the chat.

<!-- ASSET: Short code snippet showing a subset of tool definitions
     from documentTools.ts -->

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

<!-- This is the clever bit. The reader needs to understand why absolute
     positions fail under concurrent editing before relative positions
     make sense. -->

Absolute positions in a document shift when other users type, making them useless for concurrent editing. Yjs solves this with relative positions, which are anchored to CRDT items rather than offsets. They stay correct regardless of what other users do to the document.

When the user sends a message, the client encodes its current cursor and selection as relative anchors and sends them to the server as part of the chat context. This gives the agent awareness of what the user is doing and where they're looking in the document. The agent doesn't have to use this context, but when the user says "rewrite this paragraph" or "insert something here", it can target the exact semantic position the user intended.

<!-- ASSET: Short code snippet — relative anchor encode/decode -->

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

AI models have been trained on markdown as a native format. They're very good at it, and naturally use it to express formatting and emphasis. Rather than fight against this by inventing a custom format or requiring tool calls for every formatting operation, we lean into markdown as an intermediate representation.

A streaming markdown pipeline incrementally parses the token stream and converts it into the native Yjs document structure as the tokens arrive:

- `**bold**` becomes a bold mark
- `## heading` becomes a heading node
- `- item` becomes a list item

The conversion happens incrementally, so formatting streams into the document in real-time. The AI writes naturally in the format it's best at, and the document receives properly structured rich text.

<!-- ASSET: Animated gif/video showing streaming text appearing in the
     editor with the agent's cursor, while a human edits elsewhere -->

> **ASSET:** Animated gif/video — streaming text appearing in the editor with the agent's cursor, while a human edits elsewhere

## Durable chat that survives everything

<!-- This section is the most straightforward — it's mostly "swap the
     connection adapter and everything works." Keep it tight. The agent
     response flow subsection adds the interesting detail about how
     chat and document edits interact. -->

The chat sidebar uses TanStack&nbsp;AI's `useChat` hook with no custom component code. The only difference from a standard chat setup is the connection adapter: instead of the default request/response model, a durable connection routes messages through a Durable&nbsp;Stream. Messages POST to `/api/chat`, and the client subscribes to `/api/chat-stream`.

Because the chat session lives on a Durable&nbsp;Stream, it survives everything. Refresh the page mid-generation and the chat picks up where it left off. Close the tab entirely, come back later, and the full conversation history is there, including any generations that completed while you were away.

The chat and document streams are linked but independent. You can have the chat open without the editor, or vice versa.

<!-- ASSET: Short code snippet — createDurableChatConnection usage -->

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

Cancellation is clean: stopping a generation tears down both the chat stream and any in-flight document edits.

<!-- ASSET: Screenshot showing the chat sidebar with a conversation,
     including tool call indicators showing document edits -->

> **ASSET:** Screenshot — chat sidebar with a conversation, including tool call indicators showing document edits

## Agents belong in the CRDT

The collaborative editing infrastructure already exists. Yjs handles conflict resolution, presence, and real-time sync between peers. The insight behind this demo is that an AI agent is just another peer. You don't need a separate system for AI-assisted editing. You need to plug the agent into the system you already have.

Durable&nbsp;Streams makes this practical by providing one primitive for both document sync and chat persistence. The Yjs integration handles the CRDT transport. The TanStack&nbsp;AI integration handles the chat session. Both run over the same protocol, with the same resilience and reconnection guarantees.

The patterns here aren't specific to rich text editors. Any application where an AI agent needs to collaborate on a shared data structure can use this approach. The agent is a server-side CRDT peer, it communicates through tool calls, and the CRDT handles the rest.

## Next steps

- Try the [live demo](https://collaborative-ai-editor.examples.electric-sql.com) and browse the [source code](https://github.com/electric-sql/collaborative-ai-editor)
- Read the [Durable&nbsp;Streams + Yjs docs](https://durablestreams.com/yjs) and [Durable&nbsp;Streams + TanStack&nbsp;AI docs](https://durablestreams.com/tanstack-ai)
- Check out [Durable&nbsp;Streams Cloud](https://durablestreams.com) for hosted infrastructure
- [Reach out on Discord](https://discord.electric-sql.com) if you have questions or want help building something similar

***

<!-- DELETE EVERYTHING BELOW THIS LINE BEFORE PUBLISHING -->
<!--
## Planning meta

### Intent

- **What:** How to build a collaborative AI editor where an LLM joins as
  a real-time peer in a shared document, using Durable Streams as the
  single transport for both Yjs document sync and AI chat sessions.
- **Hook:** Instead of stitching together separate systems for
  collaboration, chat persistence, and AI streaming, Durable Streams
  collapses it into one primitive. The AI becomes a true collaborative
  peer, and durability comes free.
- **Takeaway:** Durable Streams is a natural fit for collaborative AI
  apps — sync, persistence, and resilience are properties of the
  transport, not things you build. Making an AI agent a first-class CRDT
  peer is a reusable architecture pattern.
- **CTAs:** Try the live demo, clone the repo, explore Durable Streams
  docs, try Durable Streams Cloud.
- **Authority:** Built the demo, years of Yjs experience, works at
  Electric (the Durable Streams team), company has CRDT inventors as
  scientific advisors.

### Title brief

Confirmed: "AI agents as CRDT peers: building a collaborative AI editor with Yjs"

### Description brief (SEO)

Should convey: technical walkthrough of building a collaborative AI
editor where an LLM is a real-time CRDT peer, using Durable Streams
for both Yjs document sync and AI chat. Target keywords: collaborative
AI editor, Yjs, Durable Streams, CRDT, TanStack AI.

### Excerpt brief (blog listing card)

2-3 short sentences. Hit: what the demo is (collaborative AI editor),
the key insight (Durable Streams as unified transport for Yjs + AI chat),
and what the reader gets (a walkthrough of how to build it).

### Image prompt

Concept: "Twin cursors in a data stream" — two glowing cursor shapes,
one human and one AI, floating as peers in the same flowing river of
data. Abstract, not a literal editor screenshot.

#### Shared prompt (paste this first, then add one variation below)

Create a blog header image, 1536 x 950 pixels, 16:9 aspect ratio.

Style: Clean 3D rendered, crystalline/geometric forms with dramatic
glow and particle effects. Not photorealistic — stylised and bold.
Soft volumetric lighting, subtle lens flare. Dark space/void
background with fine star-like particles.

Colour palette: Dark background required. Use these brand colours
as accents:
- #75fbfd (cyan — primary for streams/data flow)
- #D0BCFF (purple — for the AI/agent cursor)
- #00d2a0 (green — for the human cursor)
Colours should appear as light/energy, not flat fills. Gradients
between brand colours are fine.

Composition: Centered subject within the inner 70% of the frame.
Breathing room on all edges for responsive cropping. The two cursors
should be roughly side by side, neither dominant — they are peers.
Clean upper area.

Mood: Bold, technical, elegant. The feeling of two entities
collaborating in the same space. Not cold or clinical — there
should be warmth in the interaction between the two cursors.

CRITICAL: No text in the image. Dark background. The image will be
displayed alongside the post title — they should work as a pair.
Master as high-quality JPG.

---

#### Variation A: River of light

Two glowing cursor shapes — one green (#00d2a0), one purple
(#D0BCFF) — floating side by side in a wide, flowing river of
cyan (#75fbfd) data particles. The river flows horizontally across
the frame. Both cursors create matching ripples and wake patterns
in the particle stream, showing they're affecting the same data.
The cursors are abstract geometric forms — elongated diamond or
chevron shapes, like text cursors but crystalline and luminous.
Fine threads of light connect each cursor down into the stream.
Subtle depth of field, particles in foreground slightly blurred.

#### Variation B: Shared field

Two glowing cursor shapes — one green, one purple — hovering above
a dark plane covered in flowing, horizontal lines of tiny cyan
particles (evoking lines of text, but abstract). The cursors cast
pools of coloured light onto the plane beneath them — green and
purple — that overlap slightly where the cursors are close together,
creating a blended glow. The particle lines flow and shift beneath
both cursors. The overall composition is like a dark desk or
document surface seen at a slight angle, with the two cursors
as the focal point.

#### Variation C: Convergent streams

Two glowing cursor shapes — one green, one purple — at the center
of the frame where three thin streams of light converge. One cyan
stream enters from the left (document data), one from the upper
right (awareness/presence), one from the lower right (chat). The
streams merge into a shared luminous field around both cursors.
The cursors face the same direction, side by side, as if working
together on the same task. Crystalline fragments and particles
scatter from the convergence point.

### Asset checklist

- [ ] Architecture diagram — three durable streams to browser + server agent
- [ ] Screenshot/video — Electra's cursor and presence alongside human
- [ ] Code snippet — createServerAgentSession setup
- [ ] Code snippet — document tool definitions subset
- [ ] Code snippet — relative anchor encode/decode
- [ ] Code snippet — createDurableChatConnection usage
- [ ] Animated gif/video — streaming edits with agent cursor
- [ ] Screenshot — chat sidebar with tool call indicators
- [ ] Video — full demo experience (top of post)
- [ ] Live demo link (stable, confirmed)
- [ ] Repo link — github.com/electric-sql/collaborative-ai-editor (confirmed)

### Typesetting checklist

- [ ] Non-breaking spaces where appropriate (Durable&nbsp;Streams, etc.)
- [ ] Sentence case titles, not Title Case
- [ ] Check title, image, and post at different screen widths
- [ ] No LLM tells: "it's worth noting", "importantly", "in conclusion",
      "let's dive in", "at its core", "in today's landscape"

### Open questions

- Exact code snippets to include — keep short, link to source for full context
- Video: embedded YouTube
- Async editing tease: one line (already in outline at end of "Why server-side matters")
- Repo URL: github.com/electric-sql/collaborative-ai-editor (confirmed)
-->
