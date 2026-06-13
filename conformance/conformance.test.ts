/**
 * Run the server conformance suite against an already-running Rust server.
 * Usage: RUST_SERVER_URL=http://localhost:4562 vitest run --config packages/server-rust/conformance/vitest.config.ts
 */
import { describe } from "vitest"
import { runConformanceTests } from "../../server-conformance-tests/src/index.js"

const config = {
  baseUrl: process.env.RUST_SERVER_URL ?? `http://localhost:4562`,
  longPollTimeoutMs: 500,
  subscriptions: false,
}

describe(`Rust Server Implementation`, () => {
  runConformanceTests(config)
})
