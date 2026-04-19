---
title: StreamFS
description: >-
  Shared filesystem for AI agents built on Durable Streams. Provides files, directories, metadata, content streams, and watch-based synchronization across agents.
outline: [2, 3]
---

# StreamFS

StreamFS is a shared filesystem for AI agents built on Durable Streams.

It provides filesystem semantics on top of durable streams, including files, directories, metadata, content streams, and watch-based synchronization across multiple agents.

## Install

```bash
pnpm add @durable-streams/stream-fs
```

## Initialize a filesystem

```typescript
import { StreamFilesystem } from "@durable-streams/stream-fs"

const fs = new StreamFilesystem({
  baseUrl: "http://localhost:4437",
  streamPrefix: "/fs/myproject",
})

await fs.initialize()
```

StreamFS stores state in:

- a metadata stream at `/_metadata`
- content streams at `/_content/{id}`

## Create and read files

```typescript
await fs.createFile("/notes.md", "# My Notes\n\nHello, world!")

const content = await fs.readTextFile("/notes.md")
console.log(content)
```

You can also read raw bytes with `readFile()` and replace content with `writeFile()`.

## Directories and metadata

```typescript
await fs.mkdir("/docs")

const entries = await fs.list("/")
const exists = fs.exists("/notes.md")
const stats = fs.stat("/notes.md")
```

StreamFS also supports `move()`, `deleteFile()`, `rmdir()`, and `isDirectory()`.

## Watch for changes

```typescript
const watcher = fs.watch({ path: "/", recursive: true })

watcher.on("all", (eventType, path, metadata) => {
  console.log(eventType, path, metadata)
})

watcher.on("ready", () => {
  console.log("watcher ready")
})

watcher.on("error", (error) => {
  console.error(error)
})
```

The watcher emits chokidar-style events: `add`, `change`, `unlink`, `addDir`, and `unlinkDir`.

## Why it fits AI agents

- Shared filesystem state across multiple agents
- Eventual consistency over durable streams
- Stale-write detection via `PreconditionFailedError`
- Text patch support for efficient edits
- Durable replay through metadata and content streams

## More

- `StreamFilesystem`
- `streamFsTools`
- [Core concepts](concepts)
- [JSON mode](json-mode)
