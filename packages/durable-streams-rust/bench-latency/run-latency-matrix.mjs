// Orchestrates the write/read latency matrix on this host.
//
// For each valid server config combination it: starts the server on a fresh
// data dir, waits for /health, runs latency-probe.mjs (live long-poll reader
// parked BEFORE each write), stops the server, and aggregates results.
//
// Dimensions:
//   durability:    wal | memory   (+ one wal variant with DS_UNSAFE_FAST_FSYNC=1,
//                  bench-only plain fsync instead of macOS F_FULLFSYNC)
//   read-offload:  inline | tail (default) | always
//   tail-cache:    default (64 KiB on macOS) | 0 (disabled)
//   payload sizes: 1 KiB, 4 KiB, 16 KiB, 64 KiB   (in the probe)
//
// Usage: node run-latency-matrix.mjs [--samples 12] [--out results.json] [--quick]
//   --quick runs only the default-config combos (one per durability mode).

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProbe } from './latency-probe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_BIN = join(
  HERE,
  `..`,
  `target`,
  `release`,
  `durable-streams-server`
)

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, xs) =>
      a.startsWith(`--`) ? [a.slice(2), xs[i + 1] ?? `true`] : null
    )
    .filter(Boolean)
)
const SAMPLES = args.samples ? parseInt(args.samples, 10) : 12
const OUT = args.out ?? join(HERE, `latency-results.json`)
const QUICK = `quick` in args

const FULL_COMBOS = []
for (const durability of [`wal`, `memory`]) {
  for (const offload of [`tail`, `inline`, `always`]) {
    for (const tailCache of [`default`, `0`]) {
      FULL_COMBOS.push({ durability, offload, tailCache, fastFsync: false })
    }
  }
}
// Diagnostic variant: WAL commit with plain fsync instead of F_FULLFSYNC —
// approximates the Linux/NVMe regime and isolates the macOS barrier cost.
FULL_COMBOS.push({
  durability: `wal`,
  offload: `tail`,
  tailCache: `default`,
  fastFsync: true,
})

const QUICK_COMBOS = [
  {
    durability: `wal`,
    offload: `tail`,
    tailCache: `default`,
    fastFsync: false,
  },
  {
    durability: `memory`,
    offload: `tail`,
    tailCache: `default`,
    fastFsync: false,
  },
  { durability: `wal`, offload: `tail`, tailCache: `default`, fastFsync: true },
]

const COMBOS = QUICK ? QUICK_COMBOS : FULL_COMBOS

function comboName(c) {
  return [
    c.durability + (c.fastFsync ? `+fastfsync` : ``),
    `offload=${c.offload}`,
    `tailcache=${c.tailCache}`,
  ].join(` `)
}

async function waitHealthy(port, proc, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (proc.exitCode !== null)
      throw new Error(`server exited early (code ${proc.exitCode})`)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`server never became healthy`)
}

async function runCombo(combo, index) {
  const port = 4620 + index
  const dataDir = mkdtempSync(join(tmpdir(), `ds-latency-${index}-`))
  const argv = [
    `--port`,
    String(port),
    `--data-dir`,
    dataDir,
    `--durability`,
    combo.durability,
    `--read-offload`,
    combo.offload,
  ]
  if (combo.tailCache !== `default`)
    argv.push(`--tail-cache-bytes`, combo.tailCache)

  const env = { ...process.env }
  if (combo.fastFsync) env.DS_UNSAFE_FAST_FSYNC = `1`

  const proc = spawn(SERVER_BIN, argv, {
    env,
    stdio: [`ignore`, `ignore`, `pipe`],
  })
  let stderr = ``
  proc.stderr.on(`data`, (d) => (stderr += d))

  try {
    await waitHealthy(port, proc)
    const result = await runProbe({
      url: `http://127.0.0.1:${port}/latency-bench-${index}`,
      live: `long-poll`,
      samples: SAMPLES,
    })
    return { combo, name: comboName(combo), ...result }
  } catch (err) {
    return {
      combo,
      name: comboName(combo),
      error: String(err),
      stderr: stderr.slice(-2000),
    }
  } finally {
    proc.kill(`SIGTERM`)
    await new Promise((r) => {
      proc.on(`exit`, r)
      setTimeout(() => {
        proc.kill(`SIGKILL`)
        r()
      }, 3000)
    })
    rmSync(dataDir, { recursive: true, force: true })
  }
}

const results = []
for (let i = 0; i < COMBOS.length; i++) {
  const name = comboName(COMBOS[i])
  process.stderr.write(`[${i + 1}/${COMBOS.length}] ${name} ... `)
  const r = await runCombo(COMBOS[i], i)
  results.push(r)
  process.stderr.write(r.error ? `ERROR: ${r.error}\n` : `ok\n`)
}

writeFileSync(
  OUT,
  JSON.stringify({ host: process.platform, samples: SAMPLES, results }, null, 2)
)
process.stderr.write(`results written to ${OUT}\n`)

// Markdown summary: one row per combo × size.
const KB = (n) => `${n / 1024}k`
console.log(
  `| config | size | write mean | write p50 | read mean | read p50 | read min | read max |`
)
console.log(`| --- | --- | --- | --- | --- | --- | --- | --- |`)
for (const r of results) {
  if (r.error) {
    console.log(`| ${r.name} | - | ERROR: ${r.error} | | | | | |`)
    continue
  }
  for (const [size, s] of Object.entries(r.bySize)) {
    console.log(
      `| ${r.name} | ${KB(+size)} | ${s.write.mean} | ${s.write.p50} | ${s.read.mean} | ${s.read.p50} | ${s.read.min} | ${s.read.max} |`
    )
  }
}
