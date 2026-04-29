---
title: Collaborative AI Editor
description: >-
  Collaborative rich text editor where an AI agent is a server-side CRDT peer.
deployed_url: https://collaborative-ai-editor.examples.electric-sql.com
source_url: https://github.com/electric-sql/collaborative-ai-editor
blog_post_url: /blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs
image: /img/blog/building-a-collaborative-ai-editor/header.jpg
listing_image: /img/demos/collaborative-ai-editor-demo.jpg
demo: true
order: 3
---

<script setup>
  import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
</script>

# Collaborative AI Editor

Collaborative rich text editor where an AI agent is a server-side CRDT peer. It uses [Durable Streams](/streams/) as the transport layer for both [Yjs](https://yjs.dev) document collaboration and [TanStack AI](https://tanstack.com/ai) chat sessions.

<DemoCTAs :demo="$frontmatter" />

## How it works

The demo is a [TanStack Start](https://tanstack.com/start) app with a [ProseMirror](https://prosemirror.net) / Yjs editor and an AI chat sidebar. Human users and the AI agent connect to the same Durable Streams-backed Yjs document, awareness, and chat streams.

The AI agent, Electra, runs as a server-side Yjs peer. It has its own cursor, presence, and streaming edits, so it can work in the document even when no browser is open. Read the [blog post](/blog/2026/04/08/ai-agents-as-crdt-peers-with-yjs) for more details.

<figure>
  <div class="embed-container">
    <YoutubeEmbed video-id="qdEIE5XY0wo" title="AI agents as CRDT peers: building a collaborative AI editor with Yjs" />
  </div>
</figure>

<DemoCTAs :demo="$frontmatter" />
