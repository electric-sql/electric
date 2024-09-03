---
title: PGlite
description: >-
  Embed a lightweight WASM Postgres with
  real-time, reactive bindings.
outline: deep
---

<script setup>
import { VPButton } from 'vitepress/theme-without-fonts'
</script>

<img src="/img/icons/pglite.svg" class="product-icon" />

# PGlite

Embed a lightweight WASM Postgres with
real-time, reactive bindings.

<VPButton
    href="https://pglite.dev"
    target="_blank"
    text="PGlite website ↗"
    theme="pglite"
/>
&nbsp;
<VPButton href="https://github.com/electric-sql/pglite"
    target="_blank"
    text="GitHub repo ↗"
    theme="alt"
/>

## Use cases

PGlite is a lightweight WASM Postgres build, packaged into a TypeScript library for the browser, Node.js, Bun and Deno.

<img src="https://raw.githubusercontent.com/electric-sql/pglite/main/screenshot.png"
    alt="PGlite repl screenshot"
/>

PGlite allows you to run Postgres in the browser, Node.js and Bun, with no need to install any other dependencies. It is only 2.6mb gzipped.

```js
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.query("select 'Hello world' as message;");
// -> { rows: [ { message: "Hello world" } ] }
```

It can be used as an ephemeral in-memory database, or with persistence either to the file system (Node/Bun) or indexedDB (Browser).

## How does it work?

Unlike previous "Postgres in the browser" projects, PGlite does not use a Linux virtual machine - it is simply Postgres in WASM, compiled using [Emscripten](https://en.wikipedia.org/wiki/Emscripten). It provides a mechanism for dynamic extension loading, debug tooling and an in-browser repl.

## How do I use it?

See the website and repo for more details:

<VPButton
    href="https://pglite.dev"
    target="_blank"
    text="PGlite website ↗"
    theme="pglite"
/>
&nbsp;
<VPButton href="https://github.com/electric-sql/pglite"
    target="_blank"
    text="GitHub repo ↗"
    theme="alt"
/>