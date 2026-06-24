/**
 * Run the server conformance suite against the Rust server.
 *
 * Two modes:
 *   - CI / default: builds nothing, but spawns the release binary
 *     (packages/server-rust/target/release/durable-streams-server) itself,
 *     mirroring the Caddy harness. Run with: `pnpm vitest run --project server-rust`
 *     (build the binary first with `cargo build --release`).
 *   - Manual: set RUST_SERVER_URL to point at an already-running server, e.g.
 *     RUST_SERVER_URL=http://localhost:4562 vitest run \
 *       --config packages/server-rust/conformance/vitest.config.ts
 */
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe } from "vitest"
import { runConformanceTests } from "../../server-conformance-tests/src/index.js"
import type { ChildProcess } from "node:child_process"

// Manual mode: run against an externally-started server. Otherwise spawn our own.
const externalUrl = process.env.RUST_SERVER_URL
const port = Number(process.env.RUST_SERVER_PORT ?? 4562)
const longPollTimeoutMs = 500

const config = {
  baseUrl: externalUrl ?? `http://localhost:${port}`,
  longPollTimeoutMs,
  // The Rust server implements the core protocol only; the `__ds` subscription
  // control plane is out of scope (see PR #387 / README). Skip that suite here
  // rather than report it as failing.
  subscriptions: false,
}

let server: ChildProcess | null = null

beforeAll(async () => {
  if (!externalUrl) {
    const binary = path.join(
      __dirname,
      `..`,
      `target`,
      `release`,
      `durable-streams-server`
    )
    const dataDir = mkdtempSync(path.join(tmpdir(), `ds-rust-conformance-`))
    // Extra server flags for the run-configuration matrix (CI runs the suite
    // once per config — see README "Run-configuration matrix" + ci.yml). E.g.
    // RUST_SERVER_ARGS="--durability memory" or "--zero-copy" or
    // "--tail-cache-bytes 65536". Whitespace-separated; empty = the default
    // (wal, resident cache off on Linux).
    const extraArgs = (process.env.RUST_SERVER_ARGS ?? ``).trim().split(/\s+/).filter(Boolean)
    server = spawn(
      binary,
      [
        `--port`,
        String(port),
        `--data-dir`,
        dataDir,
        // Must match config.longPollTimeoutMs so the suite's timeout assertions hold.
        `--long-poll-timeout-ms`,
        String(longPollTimeoutMs),
        ...extraArgs,
      ],
      { stdio: [`ignore`, `pipe`, `pipe`] }
    )
    server.stderr?.on(`data`, (d: Buffer) =>
      process.stderr.write(`[rust] ${d}`)
    )
    server.on(`exit`, (code) => {
      if (code) process.stderr.write(`[rust] server exited with code ${code}\n`)
    })
  }
  await waitForServer(config.baseUrl, 15000)
}, 20000)

afterAll(async () => {
  if (server) {
    server.kill(`SIGTERM`)
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
})

describe(`Rust Server Implementation`, () => {
  runConformanceTests(config)
})

async function waitForServer(
  baseUrl: string,
  timeoutMs: number
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      // Any HTTP response (a 404 on `/` included) means the listener is up.
      await fetch(baseUrl)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`Rust server did not become ready within ${timeoutMs}ms`)
}
