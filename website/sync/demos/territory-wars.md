---
title: Territory Wars
description: >-
  Multiplayer territory capture game built with Yjs CRDTs on Durable Streams.
deployed_url: /sync/demos/territory-wars/index.html
source_url: https://github.com/balegas/territory-wars
image: https://img.youtube.com/vi/r3i25BGom0s/maxresdefault.jpg
demo: true
order: 5
---

<script setup>
  import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
</script>

# Territory Wars

Multiplayer territory capture game built with [Yjs](https://yjs.dev) CRDTs on [Durable Streams](/streams/). Read the [blog post](/blog/2026/04/07/yjs-durable-streams-on-electric-cloud) for more details.

<DemoCTAs :demo="$frontmatter" />

## How it works

Built with [`y-durable-streams`](https://www.npmjs.com/package/@durable-streams/y-durable-streams) on [Durable&nbsp;Streams](/streams/). Game state is managed via [StreamDB](/blog/2026/03/26/stream-db). The game board is a Yjs Y.Map where each cell is a last-writer-wins register. Players move to claim cells and enclose territory. Player presence is tracked via ephemeral awareness streams with built-in TTL that garbage-collects stale state from disconnected&nbsp;players.

<figure>
  <div class="embed-container">
    <YoutubeEmbed video-id="r3i25BGom0s" />
  </div>
</figure>
