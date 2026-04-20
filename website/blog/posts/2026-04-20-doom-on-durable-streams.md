---
title: 'Doom on Durable Streams'
description: >-
  Can Doom run on Durable Streams? Absolutely! Live streaming, rewinding, and fork — branch any session at any point and you're instantly back in the game.
excerpt: >-
  Can Doom run on Durable Streams? Absolutely! The result: live streaming, rewinding, and fork — branch any session at any point and you're instantly back in the game.
authors: [balegas]
image: /img/blog/doom-on-durable-streams/header.jpg
tags: [durable-streams, fork, wasm, doom, demo]
outline: [2, 3]
post: true
published: true
---

Can Doom run on [Durable&nbsp;Streams](/blog/2025/12/09/announcing-durable-streams)? Absolutely! The result turned out to be surprisingly interesting and a showcase of the patterns for building multi-agent systems.

Durable Doom is a fun little experiment where we hook into the game's loop to log every state change into a Durable Stream. Live streaming, time traveling, and the ability to resume playing from any point. What enables a globally-distributed, repayable game loop is the same primitive that power multi-agents.

> [!Warning] ✨ Durable&nbsp;Doom
> [Play Durable&nbsp;Doom](https://durabledoom.com) and read the
> [Fork announcement](/blog/2026/04/15/fork-branching-for-durable-streams) for the protocol-level story.

<div class="embed-container top" style="padding-bottom: 56.25%">
  <YoutubeEmbed video-id="XwpizmaxVDY" />
</div>

## Why Doom?

Doom shipped in 1993, when the best consumer-grade CPU ran at 66MHz and people connected to the internet over analog telephone lines. To make multiplayer work under those constraints, id Software made the entire game simulation deterministic.

Every peer ran an identical copy of the game logic with the same fixed random number seed — a 256-byte lookup table baked into the source code. Given identical inputs, every machine would independently arrive at the same state. The same monsters move to the same positions, the same damage rolls land, the same doors open at the same frames.

## What we've built

A Durable&nbsp;Stream is the [data primitive for the agent loop](/blog/2026/04/08/data-primitive-agent-loop). Agents use Durable&nbsp;Streams for token streaming, logging conversation history, and collaborating with each other in multi-agent environments.

Agent loops and Game loops are simple — read context, make decision, iterate, repeat. With Durable&nbsp;Streams everything is recorded and can be replayed, explored, [forked](/blog/2026/04/15/fork-branching-for-durable-streams) linearly or in parallel. When you apply these primitives to a game loop you give it the same kind of properties:

**Live streaming:** Tail the stream of events and feed them into the game engine. It's just HTTP and fans out infinitely via a CDN.

**Time-traveling:** Every game tic is byte-addressable, and because game state is deterministic, you can move back and forward through a game session as if it were a video.

**Forking game state:** Pause any game session at any tic and fork it. You're immediately brought back into play at that exact point. This is achieved with [Fork](/blog/2026/04/15/fork-branching-for-durable-streams), a Durable&nbsp;Streams operation that allows zero-copy branching of a stream at any offset.

## How it works

The idea sounds simple. In practice, we're taking a game engine from 1993, compiling it to WebAssembly, hooking into its internals to capture and inject inputs at exactly the right point, streaming those inputs over HTTP, and replaying them in another browser at 35 tics per second — expecting both engines to produce identical state.

High-level, the architecture is divided in four layers. The game engine, DoomGeneric, runs in WASM. We've patched the engine to capture/push game tics (think of it as a logical game frame), which are sent over a bridge to Javascript land. DoomEngine is the Javascript app. It handles game sessions, replaying, live streaming and interface with the durable streams via the session handlers. A user can either be a player, where it interacts with the game engine and DoomEngine captures events and sends them to the SessionWriter, or the users can be an observer, replaying a game session to the game engine via SessionReader.

<figure>
  <img src="/img/blog/doom-on-durable-streams/architecture.jpg" alt="Durable Doom architecture: WASM game engine communicates through ring buffers across the WASM boundary to DoomEngine in JavaScript, which writes to and reads from a Durable Stream over HTTP" />
</figure>


### No backend code

There are no servers in this demo, just a static assets page. Durable&nbsp;Doom is entirely client-side: the WASM engine runs in the browser, the React app talks directly to Durable&nbsp;Streams over HTTP, and [Electric&nbsp;Cloud](/cloud) hosts the streams. There is no code running in sandboxes or game servers relaying state.

### Hooking into the game loop

A Doom tic is the unit of iteration in the game loop. Each tic is driven by a ticcmd: an 8-byte struct that encodes the player's input state for that frame.

This is the data we capture and store into the Durable&nbsp;Stream — every tic needs to be replayed at the exact same moment for any observer. The place where ticcmds flow into game logic is a single function: `G_Ticker` in `g_game.c`. We patch that function to extract or inject game tics.

We set up two hooks. `doom_capture_ticcmd` grabs the ticcmd and the current position in Doom's RNG lookup table — a fixed 256-byte table that predates Doom itself and was reused across several id Software games. Storing the RNG position alongside each ticcmd ensures the observer stays in sync. `doom_get_observer_ticcmd` does the reverse: it injects a ticcmd from the stream and force-restores the RNG index.

Where these hooks sit matters. `G_Ticker` processes game actions before it enters the per-player loop — level transitions, difficulty adjustments, map setup — all of which call `P_Random` and advance the RNG index. We run our hooks after that processing, so both engines see the same RNG state going into the tic's game logic. Getting this wrong causes the game to drift — monsters start spawning in different positions, damage rolls diverge, and the replay becomes unusable.

### Player mode

We use Emscripten's `emscripten_set_main_loop` to drive the game loop — this schedules a C function on the browser's animation frame loop. We enforce one tic per call with `singletics = true` to disable Doom's built-in catch-up batching. Without it, the engine tries to run multiple tics per frame to match wall-clock time, and the player and observer would produce different numbers of tics per frame and drift apart.

Tics are saved into a ring buffer. On every `requestAnimationFrame`, JavaScript drains the ring buffer across the WASM boundary and hands the frames to SessionWriter, which batches them into a single HTTP POST to the Durable&nbsp;Stream.

### Observer mode

Observer mode inverts the flow. The C code no longer drives the main loop — instead, SessionReader subscribes to the player's Durable&nbsp;Stream and retrieves data frames. As frames arrive, JavaScript pushes them into a C-side playback buffer and calls `doom_observer_run(N)` to advance the engine by exactly N tics, each with an injected ticcmd and a force-restored `prndindex`.

## Doom on Durable&nbsp;Streams

Every game session is recorded in a Durable&nbsp;Stream that holds the complete input history of the run. With that, we've built live streaming, scrubbing, and forking at any point.

We use a binary format. Every session stream has a header terminated by a newline, followed by a sequence of fixed-size 9-byte frames, one per tic.

<figure>
  <img src="/img/blog/doom-on-durable-streams/frame-format.jpg" alt="Durable Doom binary frame format: header followed by fixed-size 9-byte frames, one per tic" />
</figure>

Tic counting is implicit in the stream position. There's no tic number stored in the frame — the position is the identity. `offset(tic) = headerSize + tic × 9`. Players append new tics to the stream and observers subscribe to changes using live mode.

### Live streaming

An observer opens a session URL to follow a live run. The Durable&nbsp;Stream client subscribes to new tics with the `live` query parameter — it reads all existing tics as catch-up, then switches to server-sent events (or long poll) for new tics as the player produces them. Multiple observers can watch the same session concurrently. Durable&nbsp;Streams are served over HTTP, so every tic is cacheable at the CDN with virtually infinite fan-out.

The observer sees the player's game unfold in real time by re-executing the tics in the local engine. If the observer falls behind, it catches up by running tics faster than real time with rendering disabled until it reaches the tail of the stream.

### Fake time

Doom paces tics using wall-clock time — each tic sleeps briefly and checks if enough time has passed to advance. At 35fps, that's one tic every ~28ms. This works fine in player mode, where the engine renders one frame per real-time interval. It doesn't work for observers: catch-up and scrubbing replay hundreds of tics in a tight loop that finishes in a few real milliseconds, so the engine thinks no time has passed and stalls.

The fix is a fake clock. Each observer tic bumps the fake clock by 28.571ms. The engine checks the real clock for a player and the fake clock for an observer, seeing consistent time progression regardless of how fast tics actually execute.

### Scrubbing

A fun feature of the demo is the ability to jump to any point in time with the scrubber. To reproduce game state at a given moment, the engine needs to execute all tics from the beginning.

Forward seek is straightforward — we disable rendering and push tics into the engine, which runs at thousands of tics per second when it's not drawing frames. Backward seek is a lot more expensive. To reach an earlier state, we need to replay every tic from the beginning, and with the scrubber that means continuously resetting the position. We had to pull a few tricks to make this feel smooth.

### Snapshots

Every two minutes of play, we checkpoint the engine — dump the entire WASM linear memory, compress it, and write it to its own Durable&nbsp;Stream. WASM makes this almost trivially simple: the engine's entire state lives in a single flat byte array (`HEAPU8`). Snapshotting is reading that array. Restoring is a single `HEAPU8.set()` that overwrites the engine state in place. No serialization, no object graphs — just bytes in, bytes out. Doom uses very little of its 32MB heap, so gzip collapses each snapshot to 500KB–1.5MB.

Backward seek becomes: find the nearest snapshot before the target tic, restore the WASM memory in place, replay the delta with rendering disabled. Worst case is two minutes of replay — at most 4,200 tics. At that scale, scrubbing feels instant at any session length.

Each snapshot is stored in a separate closed Durable&nbsp;Stream with a deterministic URL: `{sessionId}-{tick}`. A sidecar index stream tracks which tics have snapshots — 8 bytes per entry. One lookup, one fetch. If a snapshot is missing, the client falls back to the next nearest one.

### Forking a session

When you're watching someone else's run, you can click fork and you're back in the game at that exact point. Your session is a new branch that started where the original was, at that exact moment. The original continues to exist, untouched, still streaming live for anyone watching — it looks like magic, but it's just a stream operation.

[Fork](/blog/2026/04/15/fork-branching-for-durable-streams) is a Durable&nbsp;Streams operation — create a new stream that shares a prefix with an existing one and diverges from there, with no data copy. Fork has many use cases in [agentic workflows](/blog/2026/01/12/durable-sessions-for-collaborative-ai) and is the primary reason we built it into the Durable&nbsp;Streams protocol. You can use fork to explore parallel paths where a fleet of agents fans out from the same context, build conversation trees, or create scratch contexts where you interrogate an agent without polluting the main session history.

When you click fork, under the hood we take the current game tic, convert it to a byte offset, and fork the stream at that point, zero bytes copied. The engine flips from observer to player — it stops injecting tics and starts capturing them, appending to the new session stream. Anyone can start watching a forked session immediately.

### No loading screens

We wanted to build a fluid experience. Once the game engine is loaded, there are no spinners or loading screens — whether you're scrubbing backward or streaming a live session from the other side of the world.

The game engine has no idea how tics arrive. It just reads and writes through a buffer that sits at the WASM boundary — the stream is entirely a JavaScript concern. This is what makes fork seamless: when we fork a session, the engine doesn't need to restart or reinitialize. We swap the underlying stream, update the browser URL via `window.history.replaceState` — not navigate, which would remount the React component and destroy the WASM instance — and flip the engine from observer to player mode. Same memory, same canvas, same game state.

## What we've learned

Durable&nbsp;Doom started as a weekend project inspired by the meme *Will it run Doom?* It turned into something more. It's a stress test of the data primitive we've built for agent infrastructure running at scale. High-cardinality events, fanout readers, replayable history — the exact patterns of multi-agent workflows. No sandboxes, no backend code, just HTTP.

This probably is not the technology that is going to be adopted by AAA studios for building modern games with complex physics and nondeterministic logic, but everyone else is building agents — agents need durable state.

Try Durable&nbsp;Streams services on [Electric&nbsp;Cloud](/cloud). Sign up, create a stream service, and start having fun.

***

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="https://durabledoom.com"
        text="Play Durable Doom"
        theme="brand"
    />
    &nbsp;
    <VPButton
        href="https://dashboard.electric-sql.cloud/?intent=create&serviceType=streams"
        text="Sign up"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://durablestreams.com"
        text="Docs"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://discord.electric-sql.com"
        text="Join Discord"
        theme="alt"
    />
  </div>
</div>
