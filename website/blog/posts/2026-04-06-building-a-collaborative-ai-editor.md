---
title: 'AI agents as CRDT peers: building a collaborative AI editor with Yjs'
description: >-
  ...
excerpt: >-
  ...
authors: [samwillis]
image: /img/blog/building-a-collaborative-ai-editor/header.jpg
tags: [durable-streams, yjs, agents, collaboration, tanstack-ai]
outline: [2, 3]
post: true
published: true
---

<!-- TLDR: State the point immediately. No setup, no preamble. Technical
     audience wants to know what this is and why it matters in under
     10 seconds. -->

I've spent years in the collaborative editing space, it's how I discovered sync engines. Since AI agents became part of my daily workflow, I've had an ear worm: what would it look like to integrate an AI agent into a Yjs rich text editing flow — not as a sidebar that dumps text, but as a real participant with its own cursor, presence, and streaming edits?

This post walks through how I built a [Collaborative AI Editor](https://collaborative-ai-editor.examples.electric-sql.com) demo — a TanStack Start app with a ProseMirror/Yjs editor and an AI chat sidebar — using [Durable&nbsp;Streams](https://durablestreams.com) as the single transport layer for both [Yjs](https://yjs.dev) document collaboration and [TanStack&nbsp;AI](https://tanstack.com/ai) chat sessions. Two integrations, one primitive, and the AI becomes a genuine CRDT peer.

> [!Warning] Collaborative AI Editor demo
> Try the [live demo](https://collaborative-ai-editor.examples.electric-sql.com) and browse the [source code](https://github.com/electric-sql/collaborative-ai-editor).

<!-- ASSET: Video embed of the full demo experience -->

<!-- SITUATION: Head-nodding statements. The reader already believes these
     things. Establish shared reality — no persuasion, just recognition.
     Sam's personal context grounds this in lived experience, not theory. -->

## The obvious intersection

- AI-assisted writing and editing is everywhere — ChatGPT Canvas, Cursor, Notion AI all let an AI modify a document alongside you
- Software engineers see this more clearly than most: we already have agents editing our code files daily, working alongside us in the same codebase
- Real-time collaboration is table stakes for productivity tools — Google Docs and Figma taught everyone to expect it
- The technology for collaborative editors has evolved — from operational transforms (OT) in earlier editors like Google Docs, to CRDTs which don't need a central server to resolve conflicts. Yjs is the dominant CRDT toolkit for building these editors today
- The intersection is obvious: collaborative AI editing, where humans and AI agents work in the same document at the same time

<!-- COMPLICATION: Introduce tension. The reader should feel "yes, that's
     my problem." This is grounded in what Sam actually encountered and
     observed — not theoretical concerns. The diff/patch vs CRDT structure
     point is the sharpest technical hook. -->

## But the integration is painful

- Building this means integrating at least three separate real-time systems: CRDT sync for the document, token streaming for the AI, and presence/awareness — each with its own transport, connection lifecycle, persistence, and failure handling
- Most AI writing tools generate a diff directly and patch the document — but that's markdown or plain text. A rich text document built on CRDTs is a data structure, not a string. You need to stream edits in as CRDT operations, not text patches
- Many use client-side tool calls to edit the document locally — requiring the doc to be open in a browser. A server-side agent supports both sync and async editing
- The integration surface is painful: one protocol for Yjs, another for AI streaming, custom persistence for chat history, separate reconnection logic for each layer
- You end up with a fragile stack where every system fails independently

<!-- STYLE: The transition from complication to answer should feel natural —
     Sam worked on Durable Streams, then the Yjs integration, then the
     TanStack AI integration. Gluing them together was the obvious next step. -->

Having worked on Durable Streams, then built the [Yjs integration](https://durablestreams.com/yjs), then the [TanStack AI integration](https://durablestreams.com/tanstack-ai), the natural question was: what if these two integrations shared the same infrastructure?

<!-- ANSWER SECTIONS: Each ## is a component of the answer. Order by
     importance. Show, don't tell — code and examples over assertions. -->

## Three streams, one primitive

<!-- This section establishes the architectural foundation. The reader
     should understand the "shape" of the system before diving into
     specifics. Keep it concrete — what are the three streams, how do
     they connect. -->

- Durable Streams is a persistent, addressable HTTP streaming protocol — data in, subscribers out, with automatic catch-up from any offset
- The Collaborative AI Editor uses three Durable Streams per document:
  - **Yjs document** — streaming edits and persistence, with the Yjs Durable Stream server handling compaction and GC
  - **Yjs awareness** — cursor positions, selections, and presence of other users and agents working on the document
  - **TanStack AI chat** — the conversation session between users and the AI agent
- The `YjsProvider` abstracts the two Yjs streams behind a single base URL — you configure one endpoint and the provider manages the document and awareness streams for you
- [`@durable-streams/y-durable-streams`](https://durablestreams.com/yjs) wraps a standard `YjsProvider` — the Yjs client doesn't know it's running over Durable Streams, it just works
- [`@durable-streams/tanstack-ai-transport`](https://durablestreams.com/tanstack-ai) provides a durable connection adapter for TanStack AI's `useChat` — chat messages POST to one endpoint, the stream reads from another
- Both use the same underlying protocol: HTTP streaming with durable persistence and automatic reconnection
- No WebSocket servers to manage, no separate persistence layer to build, no custom reconnection logic per system
- The dev server (`@durable-streams/server`) runs locally with file-backed storage; production runs on Durable Streams Cloud or self-hosted

<!-- ASSET: Architecture diagram showing the three durable streams (Yjs doc,
     Yjs awareness, AI chat) flowing through the same Durable Streams
     infrastructure to the browser and server agent -->

## The AI as a CRDT peer

<!-- The key architectural decision. The reader should understand WHY
     server-side matters, not just that it's server-side. The contrast
     with client-side tool calls is the hook. -->

- The key architectural choice: the AI agent is a server-side Yjs peer, not a client-side bolt-on
- `createServerAgentSession` opens a separate `Y.Doc` and `YjsProvider` connected to the same Durable Stream as the human editors — the agent is "Electra", another participant in the room
- Electra has its own awareness state: cursor position, selection, and status (`thinking`, `composing`, `idle`) — visible to all connected users through the cursor plugin
- Agent edits use a distinct transaction origin and `addToHistory: false` — so the human's undo stack isn't polluted by AI changes
- The agent works through TanStack AI tool calls: snapshot the document, search and replace, insert at cursor, rewrite selection, stream markdown
- `DocumentToolRuntime` is the bridge: it receives tool calls from the AI model, translates them into Yjs operations on the server-side `Y.Doc`, and the CRDT sync propagates changes to all connected clients
- Because it's a server-side peer, the agent can edit the document whether or not any browser has it open — no client required

<!-- ASSET: Screenshot or short video showing Electra's cursor and
     presence in the editor alongside a human user -->

<!-- ASSET: Short code snippet — createServerAgentSession setup or
     awareness config -->

### Why server-side matters

- Client-side tool calls (the common approach) require the document to be open in a browser tab — the AI can only edit when a user is watching
- A server-side peer means the agent can work asynchronously — start an edit, close your laptop, come back later and the work is done
- It also means the CRDT handles conflicts naturally — if two humans and an agent are all editing simultaneously, Yjs merges everything without coordination
- More on sync and async collaboration with AI agents in a future post

## Streaming edits into a live document

<!-- This is the most technically dense section. The reader needs to
     understand the problem (you can't just append characters one at a
     time to a CRDT) before the solution makes sense. Walk through
     the techniques in logical order: tools → anchors → commits → markdown. -->

- The hard problem: the AI generates markdown text, but the document is a rich text CRDT — a structured data type, not a string. You need to convert streaming markdown tokens into rich text nodes and insert them at positions that stay valid while other users edit concurrently

### Document tools

<!-- The tool surface defines the contract between the AI model and the
     document. Emphasise that it's deliberately constrained — the agent
     edits like a collaborator, not an omnipotent mutator. -->

- The agent doesn't free-form edit the `Y.Doc` — it works through a defined set of Zod-validated tool calls that TanStack AI routes to `DocumentToolRuntime`
- The core flow is: **read → locate → edit**
- **get_document_snapshot** — reads a plain-text snapshot of the current document so the agent can see what's there before acting
- **search_text** — find exact text in the document and get back stable match handles with surrounding context. The agent uses this to locate its own insertion points based on its reading of the document — independent of where the user's cursor is
- **place_cursor** / **place_cursor_at_document_boundary** — move the agent's cursor to a match handle or to the start/end of the document, setting up the insertion point for the next edit
- **insert_text** — insert content at the agent's current cursor position, resolved via relative anchors
- **start_streaming_edit** — arms the next edit (see below)
- Plus tools for selection inspection, bulk replace, formatting (`set_format`), and deletion
- The search → place cursor → edit flow means the agent locates content by meaning, not by position. This works reliably under concurrent editing because the match handles are backed by Yjs relative positions
- Each tool receives the runtime's server-side `Y.Doc` reference and applies changes with agent transaction origin — human editors see the edits arrive through CRDT sync like any other peer's changes
- The tool surface is deliberately constrained — the agent operates through the same kinds of editing actions a human would, not arbitrary document mutations

### Routing streaming text into the document

<!-- This is one of the most interesting implementation details. It
     deserves its own subsection because it solves a real limitation
     of tool-based AI architectures. -->

- Tool calls don't support async streaming — you call a tool and get a result back. But we want the model to stream prose into the document token by token
- The solution: `start_streaming_edit` is a tool that flips a routing switch. After it's called, the model's next text output — which normally streams into the chat as an assistant message — gets intercepted by `routeAgentStreamChunks` and redirected into the document via `DocumentToolRuntime` instead
- `start_streaming_edit` takes a `mode` (continue, insert, or rewrite) and a `contentFormat` (plain text or markdown). Rewrite mode replaces the current selection; insert and continue modes write at the cursor
- When the model finishes generating or calls another tool, the routing automatically stops — or the model can explicitly call `stop_streaming_edit` to switch back to chat output
- The system prompt explains this convention to the model so it knows to call `start_streaming_edit` before generating document prose, and to switch back when it wants to talk in the chat
- This is a clean separation: the model just generates text naturally, the infrastructure decides where it goes

<!-- ASSET: Short code snippet showing a subset of tool definitions
     from documentTools.ts -->

### Relative position anchors

<!-- This is the clever bit. The reader needs to understand why absolute
     positions fail under concurrent editing before relative positions
     make sense. -->

- Absolute positions shift when other users type — useless for concurrent editing
- Yjs relative positions are anchored to CRDT items, not offsets — they stay correct regardless of concurrent edits
- The client encodes its cursor/selection as relative anchors and sends them to the server via the chat context
- The agent decodes these on the server-side `Y.Doc` and uses them to target inserts and rewrites at the exact semantic position the user intended
- After each commit the agent re-encodes the anchor so the insertion point follows any concurrent edits — the anchor is always fresh

<!-- ASSET: Short code snippet — relative anchor encode/decode -->

### Streaming markdown into the document

- The edits stream into the document in real-time — the user sees text appear as the AI generates it, just like watching another person type. The agent's cursor moves through the document as it writes
- AI models have been trained on markdown as a native format — they're very good at it, and naturally use it to express formatting and emphasis
- Rather than fight against this by inventing a custom format or limiting the agent to tool calls for every formatting operation, we lean into markdown as an intermediate representation
- The agent generates markdown, and a `streaming-markdown` pipeline incrementally parses it and converts it into the native Yjs document structure — ProseMirror nodes like paragraphs, headings, lists, and inline marks
- This happens incrementally as the tokens arrive, so formatting streams into the document in real-time — a `**bold**` in the markdown stream becomes a bold mark in the rich text document as it's generated
- The result: the AI writes naturally in the format it's best at, and the document receives properly structured rich text — streamed in token by token

<!-- ASSET: Animated gif/video showing streaming text appearing in the
     editor with the agent's cursor, while a human edits elsewhere -->

## Durable chat that survives everything

<!-- This section is the most straightforward — it's mostly "swap the
     connection adapter and everything works." Keep it tight. The agent
     response flow subsection adds the interesting detail about how
     chat and document edits interact. -->

- The chat sidebar uses TanStack AI's `useChat` hook — standard API, nothing custom in the component code
- The connection adapter is swapped for a durable one: messages POST to `/api/chat`, the stream reads from `/api/chat-stream`
- Both endpoints are backed by the same Durable Stream — the POST appends to it, the GET subscribes from the client's current offset
- Refresh the page mid-generation and the chat picks up where it left off — the stream is persistent, the client reconnects and catches up
- Close the tab entirely, come back later — the full conversation history is there, including any generations that completed while you were away
- The chat and the document are linked but independent streams — you can have the chat open without the editor, or vice versa

<!-- ASSET: Short code snippet — createDurableChatConnection usage -->

### The agent response flow

- When the user sends a message, `/api/chat` runs TanStack AI's `chat()` with OpenAI and the document tools
- The agent's text responses stream back through the durable chat stream to all subscribers
- When the agent calls a document tool, `DocumentToolRuntime` applies the edit to the Yjs doc — the edit propagates through the Yjs Durable Stream, the tool result goes back through the chat Durable Stream
- After tool-driven edits, the agent can stream a summary of what it changed back into chat — so the conversation log explains what happened even if you weren't watching the editor
- Cancellation is handled cleanly: abort controllers are tied to the document and session, so stopping a generation tears down both the chat stream and any in-flight document edits

<!-- ASSET: Screenshot showing the chat sidebar with a conversation,
     including tool call indicators showing document edits -->

## Next steps

- Try the [live demo](https://collaborative-ai-editor.examples.electric-sql.com) and browse the [source code](https://github.com/electric-sql/collaborative-ai-editor)
- Read the [Durable Streams + Yjs docs](https://durablestreams.com/yjs) and [Durable Streams + TanStack AI docs](https://durablestreams.com/tanstack-ai)
- Check out [Durable Streams Cloud](https://durablestreams.com) for hosted infrastructure
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
