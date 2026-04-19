---
title: Mega Draw
titleTemplate: "... - Electric Agents"
description: >-
  Multi-agent collaborative drawing example with coordinator-worker patterns and 100 tile agents.
outline: [2, 3]
---

# Mega Draw

A collaborative multi-agent drawing app where 100 AI agents each own a tile of a shared 1000x1000 pixel canvas and work together to produce a drawing from a single text prompt. Located at `examples/mega-draw/` in the repository.

## What it demonstrates

- **Coordinator + worker pattern** at scale (1 coordinator spawning 100 tile agents)
- **Custom drawing tools** --- `fill_rect`, `draw_line`, `draw_circle`, `fill_gradient`, `set_pixels`
- **Shared canvas** --- in-memory pixel buffer flushed to PNG, served via a live viewer
- **Follow-up instructions** --- send a new prompt and only affected tiles get re-instructed
- **Two-pass workflow** --- coordinator does a quick first pass for backgrounds, then a detail pass

## Architecture

```
User
  │
  │  spawn /coordinator/my-drawing
  │  send "Draw a sunset over mountains"
  ▼
┌────────────────────────────────┐
│       Coordinator Agent        │
│  - Receives prompt             │
│  - Plans composition + palette │
│  - Spawns 100 tile agents      │
│  - Can re-instruct tiles       │
└──────────┬─────────────────────┘
           │ spawn tile-agent (10×10 grid)
           ▼
┌────────┐ ┌────────┐
│Tile 0,0│ │Tile 1,0│  ...  (10 columns)
└────────┘ └────────┘
┌────────┐ ┌────────┐
│Tile 0,1│ │Tile 1,1│  ...
└────────┘ └────────┘
   ...        ...       (10 rows = 100 tiles)
```

Each tile agent:

- Owns a 100x100 pixel region
- Can **see** 50px beyond its borders (200x200 viewport) for edge coordination
- Can only **draw** within its own tile
- Receives drawing instructions from the coordinator

## Key files

### `src/server.ts`

Entry point. Creates the registry, runtime handler, and two HTTP servers (one for the webhook, one for the canvas viewer).

```ts
const registry = createEntityRegistry()
registerCoordinator(registry, WEB_PORT)
registerTileAgent(registry)

const runtime = createRuntimeHandler({
  baseUrl: DARIX_URL,
  serveEndpoint: `${SERVE_URL}/webhook`,
  registry,
})
```

### `src/coordinator.ts`

The coordinator entity. Defines two custom tools:

- `set_drawing_plan` --- sets the composition description and color palette
- `instruct_tile` --- spawns or re-instructs a tile agent with drawing directions

### `src/tile-agent.ts`

The tile agent entity. Each instance gets drawing tools scoped to its tile:

- `read_viewport` --- see current pixel state (own tile + neighbors)
- `fill_rect`, `draw_line`, `draw_circle`, `fill_gradient`, `set_pixels`

All coordinates are tile-relative (0--99) and automatically clipped to tile bounds.

## Running it

```bash
cd examples/mega-draw
pnpm install
cp ../../.env.template .env  # Set ANTHROPIC_API_KEY
pnpm dev
```

Requires a running runtime server at `http://localhost:4437`.

Then in another terminal:

```bash
darix spawn /coordinator/my-drawing
darix send /coordinator/my-drawing 'Draw a sunset over mountains'
```

View the canvas live at `http://localhost:3000/my-drawing` --- it auto-refreshes as tiles draw.
