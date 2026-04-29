#!/usr/bin/env node

/**
 * Generate social-card (OG) images by screenshotting the dedicated
 * `/og/*` routes that ship in the VitePress site. Each route renders
 * a single 1200x630 card (see `src/components/og/*.vue`); this script
 * boots a private VitePress dev server, drives Playwright over each
 * route in turn, and writes a JPEG to `public/img/meta/<file>.jpg`.
 *
 * Why a separate dev server (and not the one a developer might already
 * have on :5173)? Two reasons:
 *
 *   1. We don't want the script to fight a developer's running dev
 *      server, or to silently use a stale build if their server is
 *      pointed at a different commit.
 *   2. The Vue HMR client and the VitePress dev banner sometimes
 *      flicker into the viewport during the first frames after page
 *      load. Running our own server with a fresh, idle page settles
 *      these reliably before we screenshot.
 *
 * Usage
 * -----
 *   pnpm build-og-images          # regenerate every OG card
 *   pnpm build-og-images sync     # regenerate just `/og/sync`
 *
 * Env
 * ---
 *   OG_PORT       Port for the private dev server (default 5290).
 *   OG_TIMEOUT_MS Per-page total timeout in ms (default 30000).
 *   OG_KEEP       If `1`, leave the dev server running after
 *                 capturing — useful when iterating on a card design.
 */

import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const websiteDir = path.resolve(__dirname, '..')
const OUTPUT_DIR = path.resolve(websiteDir, 'public/img/meta')

const PORT = Number(process.env.OG_PORT ?? 5290)
const HOST = `http://127.0.0.1:${PORT}`
const VIEWPORT = { width: 1200, height: 630 }
// Render at 2x device pixels so the downscaled JPEG stays sharp on
// retina previews. Twitter / Slack / Discord all serve the meta image
// at logical 1x so a 2x render → 1x JPEG output gives clean
// edge-anti-aliasing on the typography without bloating the file.
const DEVICE_SCALE_FACTOR = 2
const PER_PAGE_TIMEOUT_MS = Number(process.env.OG_TIMEOUT_MS ?? 30_000)
const KEEP_SERVER_RUNNING = process.env.OG_KEEP === '1'

/**
 * Manifest of OG cards. `slug` maps to the markdown route under
 * `website/og/<slug>.md`; `out` is the filename written under
 * `public/img/meta/`. Existing meta filenames are preserved where
 * possible so any pages that already set `image:` in frontmatter
 * (`postgres-sync.md`, `tanstack-db.md`, `pglite.md`) keep working
 * unchanged.
 */
const TARGETS = [
  // Site-wide social fallback (`DEFAULT_IMAGE` in config.mts).
  { slug: 'default', out: 'electric.jpg' },
  // Four landing pages.
  { slug: 'sync', out: 'electric-sync.jpg' },
  { slug: 'streams', out: 'electric-streams.jpg' },
  { slug: 'agents', out: 'electric-agents.jpg' },
  { slug: 'cloud', out: 'electric-cloud.jpg' },
]

function parseArgs() {
  const args = process.argv.slice(2)
  if (args.length === 0) return { only: null }
  if (args.length === 1 && args[0] !== '--help' && args[0] !== '-h') {
    return { only: args[0] }
  }
  printUsageAndExit()
}

function printUsageAndExit() {
  console.log(
    [
      'Usage: pnpm build-og-images [slug]',
      '',
      '  slug   Optional. Regenerate a single card. One of:',
      ...TARGETS.map((t) => `           ${t.slug}  →  ${t.out}`),
      '',
      '  Run with no arguments to regenerate every card.',
    ].join('\n')
  )
  process.exit(0)
}

/**
 * Boot a private VitePress dev server on `PORT`. Resolves once the
 * server prints its `Local:` line, or rejects on timeout.
 */
async function startDevServer() {
  console.log(`▸ Starting VitePress dev server on :${PORT}…`)
  const child = spawn(
    'npx',
    ['vitepress', 'dev', '.', '--port', String(PORT), '--host', '127.0.0.1'],
    {
      cwd: websiteDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'development' },
    }
  )

  return new Promise((resolve, reject) => {
    let resolved = false
    const onChunk = (chunk) => {
      const s = chunk.toString()
      // VitePress dev prints something like:
      //   ➜  Local:   http://127.0.0.1:5290/
      if (
        !resolved &&
        (s.includes('Local:') || s.includes(`localhost:${PORT}`))
      ) {
        resolved = true
        resolve(child)
      }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('exit', (code) => {
      if (!resolved)
        reject(
          new Error(`vitepress dev exited before becoming ready (code ${code})`)
        )
    })
    setTimeout(() => {
      if (!resolved) {
        try {
          child.kill('SIGTERM')
        } catch {}
        reject(new Error('Timed out waiting for VitePress dev server (60s)'))
      }
    }, 60_000)
  })
}

/**
 * Wait for the OG card to be visible and stable in the viewport.
 *
 * Each hero rendered inside the OG card is mounted with its built-in
 * `paused` flag set, which the canvas backgrounds (`HeroNetworkBg`,
 * `SyncFanOutBg`, `StreamFlowBg`, the homepage `HomeCompositionHero`)
 * read to gate ambient spawns, motion, and tweens — no new tokens
 * spawn after mount, so the canvas converges to a stable still
 * frame within a few hundred ms of layout.
 *
 * We still freeze any non-canvas CSS animations / transitions
 * (button hovers, chip pulses, anything keyframe-driven) so a
 * keyframe caught mid-cycle on mount doesn't taint the screenshot.
 *
 * The post-fonts delay then gives the canvas a window to perform
 * its initial layout pass (seed the node / shape / rail population)
 * and paint a couple of frames before we capture.
 */
async function settle(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0.0001s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.0001s !important;
        transition-delay: 0s !important;
      }
    `,
  })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(800)
}

async function captureOne(page, target) {
  const url = `${HOST}/og/${target.slug}`
  const start = Date.now()
  console.log(`▸ ${target.slug.padEnd(14)}  ${url}`)
  await page.goto(url, {
    waitUntil: 'networkidle',
    timeout: PER_PAGE_TIMEOUT_MS,
  })
  await settle(page)

  // Capture the viewport directly. `clip` is in CSS pixels, so a
  // 1200x630 clip at deviceScaleFactor=2 produces a 2400x1260 PNG;
  // sharp downscales that to the final 1200x630 JPEG below for crisp
  // edges on the typography.
  const png = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    omitBackground: false,
  })

  const outPath = path.join(OUTPUT_DIR, target.out)
  const info = await sharp(png)
    .resize(VIEWPORT.width, VIEWPORT.height, {
      fit: 'cover',
      kernel: 'lanczos3',
    })
    .flatten({ background: '#0c0e14' })
    .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toFile(outPath)
  const elapsed = Date.now() - start
  const kb = (info.size / 1024).toFixed(1)
  console.log(
    `  ✓ wrote ${path.relative(websiteDir, outPath)}  (${kb} KB, ${elapsed} ms)`
  )
}

async function main() {
  const { only } = parseArgs()
  const targets = only ? TARGETS.filter((t) => t.slug === only) : TARGETS

  if (only && targets.length === 0) {
    console.error(`Unknown OG slug: ${only}`)
    printUsageAndExit()
  }

  if (!existsSync(OUTPUT_DIR)) {
    await mkdir(OUTPUT_DIR, { recursive: true })
  }

  let server = null
  let browser = null
  try {
    server = await startDevServer()
    console.log(`  Ready at ${HOST}\n`)

    browser = await chromium.launch()
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      // Match the site's default theme so screenshots look like the
      // production site. (The site is `force-dark`, so the OG cards
      // render in dark mode regardless, but pinning this avoids any
      // ambiguity from the browser's own preference probe.)
      colorScheme: 'dark',
    })
    const page = await context.newPage()

    for (const target of targets) {
      await captureOne(page, target)
    }

    console.log(`\n✓ Generated ${targets.length} OG image(s).`)
  } finally {
    if (browser) await browser.close()
    if (server && !KEEP_SERVER_RUNNING) {
      server.kill('SIGTERM')
      // Give the child a moment to clean up before the script exits.
      await new Promise((r) => setTimeout(r, 200))
    }
    if (KEEP_SERVER_RUNNING && server) {
      console.log(
        `\nDev server left running on ${HOST} (OG_KEEP=1).\n` +
          `Press Ctrl+C to stop.`
      )
    }
  }
}

main().catch((err) => {
  console.error('\n✗ OG image generation failed:')
  console.error(err)
  process.exit(1)
})
