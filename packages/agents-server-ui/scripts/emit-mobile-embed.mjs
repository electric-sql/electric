#!/usr/bin/env node
// Copies the freshly built mobile embed bundle into the
// @electric-ax/agents-mobile package as a static HTML asset that the
// Expo runtime can load through expo-asset (file:// in production /
// http:// from the Metro asset server in dev).
//
// Why an asset instead of a string export?
// ----------------------------------------
// The single-file embed weighs ~13 MB. Inlining it into the JS bundle
// either bloats every JS load or chokes Metro's transform pipeline.
// Shipping it as an asset keeps Metro fast and lets the WebView mount
// it via `source.uri` without copying the payload through React Native's
// JS runtime at all.
//
// Usage: pnpm --filter @electric-ax/agents-server-ui build:mobile-embed
//   1. `vite build --mode mobile-embed` produces a single
//      `dist-mobile-embed/embed.html` with all JS + CSS inlined.
//   2. This script copies that file to
//      `packages/agents-mobile/assets/embed.html`, which Metro picks
//      up automatically — Expo SDK 54 ships `html` in the default
//      Metro `assetExts`, so no project-local `metro.config.js` is
//      required.

import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, `..`, `..`, `..`)

const inputHtml = resolve(
  repoRoot,
  `packages/agents-server-ui/dist-mobile-embed/embed.html`
)
const outputHtml = resolve(repoRoot, `packages/agents-mobile/assets/embed.html`)

await mkdir(dirname(outputHtml), { recursive: true })
await copyFile(inputHtml, outputHtml)
const { size } = await stat(outputHtml)
const kb = (size / 1024).toFixed(1)
console.log(`Wrote ${outputHtml} (${kb} KB).`)
