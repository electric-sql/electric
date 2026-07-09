// Write/read latency probe for the durable-streams Rust server.
//
// Uses the real electric client (@durable-streams/client). Flow per run:
//   1. create a fresh stream
//   2. open a LIVE session (long-poll by default) and subscribe
//   3. wait until the session reports up-to-date (live poll is parked)
//   4. for each payload size: warmup appends, then N measured appends
//
// Per sample:
//   write ms = t(append() resolves)  - t(append() starts)   [server ack incl. durability]
//   read  ms = t(bytes arrive at subscriber) - t(append() starts)  [end-to-end since write timestamp]
//
// CLI: node latency-probe.mjs --url http://127.0.0.1:4437/bench-1 \
//        [--live long-poll|sse] [--samples 12] [--warmup 3] [--sizes 1024,4096,16384,65536]

import { DurableStream } from '../../agents-server-conformance-tests/node_modules/@durable-streams/client/dist/index.js'

const RECEIPT_TIMEOUT_MS = 10_000

function makePayload(size, tag) {
  const buf = new Uint8Array(size)
  const header = new TextEncoder().encode(`#${tag}|`)
  buf.set(header.subarray(0, Math.min(header.length, size)))
  buf.fill(120 /* 'x' */, Math.min(header.length, size))
  return buf
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return {
    n: s.length,
    mean: +mean.toFixed(3),
    p50: +q(0.5).toFixed(3),
    min: +s[0].toFixed(3),
    max: +s[s.length - 1].toFixed(3),
  }
}

export async function runProbe({
  url,
  live = `long-poll`,
  sizes = [1024, 4096, 16384, 65536],
  samples = 12,
  warmup = 3,
}) {
  const handle = await DurableStream.create({
    url,
    contentType: `application/octet-stream`,
  })

  const res = await handle.stream({ offset: `-1`, live })

  let receivedBytes = 0
  const waiters = []
  res.subscribeBytes((chunk) => {
    const t = performance.now()
    receivedBytes += chunk.data.byteLength
    for (const w of waiters) {
      if (!w.done && receivedBytes >= w.target) {
        w.done = true
        w.resolve(t)
      }
    }
  })

  // Wait until the live session has caught up (empty stream => immediately),
  // then give the client a beat to park the next live long-poll so every
  // measured write is delivered via the live path, not session setup.
  const deadline = Date.now() + 5000
  while (!res.upToDate) {
    if (Date.now() > deadline) throw new Error(`session never reached upToDate`)
    await new Promise((r) => setTimeout(r, 5))
  }
  await new Promise((r) => setTimeout(r, 200))

  async function oneAppend(size, tag) {
    const payload = makePayload(size, tag)
    const target = receivedBytes + size
    let resolveReceipt
    const receipt = new Promise((r) => {
      resolveReceipt = r
    })
    waiters.push({ target, resolve: resolveReceipt, done: false })

    const t0 = performance.now()
    await handle.append(payload)
    const tAck = performance.now()
    const tRecv = await Promise.race([
      receipt,
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error(`receipt timeout (tag ${tag})`)),
          RECEIPT_TIMEOUT_MS
        )
      ),
    ])
    return { writeMs: tAck - t0, readMs: tRecv - t0 }
  }

  const bySize = {}
  for (const size of sizes) {
    for (let i = 0; i < warmup; i++) await oneAppend(size, `w${size}.${i}`)
    const writes = []
    const reads = []
    for (let i = 0; i < samples; i++) {
      const { writeMs, readMs } = await oneAppend(size, `s${size}.${i}`)
      writes.push(writeMs)
      reads.push(readMs)
    }
    bySize[size] = { write: stats(writes), read: stats(reads) }
  }

  res.cancel()
  await handle.delete().catch(() => {})
  return { url, live, samples, bySize }
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .map((a, i, xs) => (a.startsWith(`--`) ? [a.slice(2), xs[i + 1]] : null))
      .filter(Boolean)
  )
  if (!args.url) {
    console.error(
      `usage: node latency-probe.mjs --url <stream-url> [--live long-poll|sse] [--samples N] [--warmup N] [--sizes a,b,c]`
    )
    process.exit(2)
  }
  const result = await runProbe({
    url: args.url,
    live: args.live ?? `long-poll`,
    samples: args.samples ? parseInt(args.samples, 10) : 12,
    warmup: args.warmup ? parseInt(args.warmup, 10) : 3,
    sizes: args.sizes
      ? args.sizes.split(`,`).map((s) => parseInt(s, 10))
      : undefined,
  })
  console.log(JSON.stringify(result, null, 2))
}
