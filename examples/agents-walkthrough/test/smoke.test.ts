import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, test } from 'vitest'

// Boots the walkthrough server (the final, "hybrid control flow" index.ts) the
// same way `pnpm dev` does and asserts it comes up and serves its root route.
// This is a build-and-boot smoke test: it does NOT talk to the Electric Agents
// runtime or the Anthropic API, so it needs no Docker and no API key. The
// server's `registerTypes()` call fails to reach the agents server and is
// caught/logged — the HTTP server still listens, which is what we check here.

const rootDir = fileURLToPath(new URL(`..`, import.meta.url))
const tsxBin = fileURLToPath(
  new URL(`../node_modules/.bin/tsx`, import.meta.url)
)
const BASE_URL = `http://localhost:3000`

let server: ChildProcess

async function waitForServer(url: string, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `Server did not start within ${timeoutMs}ms: ${String(lastError)}`
  )
}

beforeAll(async () => {
  server = spawn(tsxBin, [`src/index.ts`], { cwd: rootDir, stdio: `inherit` })
  await waitForServer(`${BASE_URL}/`)
}, 60_000)

afterAll(() => {
  server?.kill(`SIGKILL`)
})

test(`boots and serves the root route`, async () => {
  const res = await fetch(`${BASE_URL}/`)
  expect(res.status).toBe(200)
  expect(await res.text()).toBe(`Hello Hono!`)
})
