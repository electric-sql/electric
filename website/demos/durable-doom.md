---
title: Durable Doom
description: >-
  Doom on Durable Streams. Live spectating, time-travel, and fork-to-continue — all client-side, no backend.
deployed_url: https://durabledoom.com
source_url: https://github.com/balegas/durable-doom
blog_post_url: /blog/2026/04/20/doom-on-durable-streams
image: /img/blog/doom-on-durable-streams/header.jpg
demo: true
order: 2
---

# Durable Doom

Doom on [Durable&nbsp;Streams](/primitives/durable-streams). Every game tic is an offset, every offset is a branch point. Live spectating, time-travel, and [fork](/blog/2026/04/15/fork-branching-for-durable-streams)-to-continue — all client-side, no backend.

<DemoCTAs :demo="$frontmatter" />

## How it works

Doom's game engine is compiled to WebAssembly and runs entirely in the browser. Every tic (input frame) is captured and appended to a [Durable&nbsp;Stream](/primitives/durable-streams). Because Doom is a deterministic pure function of its input log, replaying the stream reproduces identical game state.

This gives Doom properties that come for free from the stream primitive:

- **Live spectating** — tail the stream over HTTP, fan out via CDN to unlimited observers
- **Time-travel** — read up to any offset and replay to that point, with WASM memory snapshots for instant backward seek
- **Fork-to-continue** — [fork](/blog/2026/04/15/fork-branching-for-durable-streams) the stream at any tic and take over someone else's playthrough mid-action

No servers, no game backends, no sandboxes. Just a static page, a WASM engine, and Durable&nbsp;Streams on [Electric&nbsp;Cloud](/cloud).

<figure>
  <div class="embed-container" style="padding-bottom: 56.25%">
    <YoutubeEmbed video-id="XwpizmaxVDY" />
  </div>
</figure>

Read the [blog post](/blog/2026/04/20/doom-on-durable-streams) for the full technical deep dive.

<DemoCTAs :demo="$frontmatter" />
