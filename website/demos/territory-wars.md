---
title: Territory Wars
description: >-
  Multiplayer territory capture game built with Yjs CRDTs on Durable Streams.
deployed_url: /demos/territory-wars/index.html
source_url: https://github.com/balegas/territory-wars
image: /img/demos/territory-wars-screenshot.png
demo: true
order: 5
---

<script setup>
  import YoutubeEmbed from '../src/components/YoutubeEmbed.vue'
</script>

# Territory Wars

Multiplayer territory capture game built with [Yjs](https://yjs.dev) CRDTs on [Durable Streams](/primitives/durable-streams).

<DemoCTAs :demo="$frontmatter" />

## How it works

The game board is a Yjs Y.Map where each cell is a last-writer-wins register. Players move to claim cells and enclose territory. Player presence is tracked via awareness streams. Game state is managed via [StreamDB](/blog/2026/03/26/stream-db). Built with [`y-durable-streams`](https://www.npmjs.com/package/@durable-streams/y-durable-streams) on [Durable&nbsp;Streams](/primitives/durable-streams).

<figure>
  <div class="embed-container" style="padding-bottom: 75.842697%">
    <YoutubeEmbed video-id="r3i25BGom0s" />
  </div>
</figure>

<DemoEmbed :demo="$frontmatter" />
