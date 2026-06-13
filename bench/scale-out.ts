/**
 * Scale-out load test: spawn N worker processes, each appending small messages
 * to its own stream with bounded concurrency, and report aggregate throughput.
 *
 * Usage: BENCH_URL=http://localhost:4564 WORKERS=4 DURATION_MS=10000 CONCURRENCY=64 \
 *        pnpm exec tsx packages/server-rust/bench/scale-out.ts
 *
 * Run with WORKER_MODE=1 internally for child processes.
 */
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"

const BASE_URL = process.env.BENCH_URL ?? `http://localhost:4564`
const WORKERS = Number(process.env.WORKERS ?? 4)
const DURATION_MS = Number(process.env.DURATION_MS ?? 10_000)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 64)
const MSG_SIZE = Number(process.env.MSG_SIZE ?? 100)

const MODE = process.env.MODE ?? `append`

async function workerMain(id: string) {
  const streamPath = `/v1/stream/scale-${id}-${Date.now()}`
  const url = `${BASE_URL}${streamPath}`
  await fetch(url, {
    method: `PUT`,
    headers: { "Content-Type": `application/octet-stream` },
  })
  const body = new Uint8Array(MSG_SIZE).fill(42)
  let sent = 0
  let bytes = 0
  let errors = 0

  if (MODE === `read`) {
    // Seed SEED_MB of data, then hammer full catch-up reads.
    const seedChunk = new Uint8Array(1024 * 1024).fill(7)
    const seedMb = Number(process.env.SEED_MB ?? 10)
    for (let i = 0; i < seedMb; i++) {
      await fetch(url, {
        method: `POST`,
        headers: { "Content-Type": `application/octet-stream` },
        body: seedChunk,
      })
    }
    const deadline = Date.now() + DURATION_MS
    const start = performance.now()
    const lane = async () => {
      while (Date.now() < deadline) {
        const res = await fetch(`${url}?offset=-1`)
        if (res.ok) {
          const buf = await res.arrayBuffer()
          bytes += buf.byteLength
          sent++
        } else {
          errors++
          await res.arrayBuffer().catch(() => {})
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, lane))
    const elapsed = (performance.now() - start) / 1000
    await fetch(url, { method: `DELETE` }).catch(() => {})
    process.send!({ sent, errors, elapsed, rate: bytes / (1024 * 1024) / elapsed })
    return
  }

  const deadline = Date.now() + DURATION_MS
  const start = performance.now()
  const lane = async () => {
    while (Date.now() < deadline) {
      const res = await fetch(url, {
        method: `POST`,
        headers: { "Content-Type": `application/octet-stream` },
        body,
      })
      if (res.ok || res.status === 204) sent++
      else errors++
      // drain body to reuse connection
      await res.arrayBuffer().catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, lane))
  const elapsed = (performance.now() - start) / 1000
  await fetch(url, { method: `DELETE` }).catch(() => {})
  process.send!({ sent, errors, elapsed, rate: sent / elapsed })
}

async function main() {
  if (process.env.WORKER_MODE) {
    await workerMain(process.env.WORKER_ID ?? `w`)
    process.exit(0)
  }
  console.log(
    `scale-out: ${WORKERS} workers x concurrency ${CONCURRENCY}, ${DURATION_MS}ms, ${MSG_SIZE}B messages -> ${BASE_URL}`
  )
  const self = fileURLToPath(import.meta.url)
  const results: Array<{ sent: number; errors: number; elapsed: number; rate: number }> = []
  await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => {
      return new Promise<void>((resolve, reject) => {
        const child = fork(self, [], {
          env: { ...process.env, WORKER_MODE: `1`, WORKER_ID: String(i) },
        })
        child.on(`message`, (m: any) => results.push(m))
        child.on(`exit`, (code) =>
          code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}`))
        )
      })
    })
  )
  const total = results.reduce((a, r) => a + r.sent, 0)
  const errors = results.reduce((a, r) => a + r.errors, 0)
  const maxElapsed = Math.max(...results.map((r) => r.elapsed))
  const unit = MODE === `read` ? `MB/s` : `msg/s`
  const aggRate =
    MODE === `read`
      ? results.reduce((a, r) => a + r.rate, 0)
      : total / maxElapsed
  console.log(`workers: ${results.map((r) => Math.round(r.rate)).join(`, `)} ${unit}`)
  console.log(
    `aggregate: ${Math.round(aggRate)} ${unit} (${total} requests, ${errors} errors, ${maxElapsed.toFixed(1)}s)`
  )
}

main()
