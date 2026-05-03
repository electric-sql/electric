import type { Page, APIRequestContext } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

export const SERVER_BASE = `http://localhost:4437`

export function uniqueAgentName(prefix = `pw`): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

export async function openSpawnDialog(page: Page): Promise<void> {
  await page.goto(`/`)
  await page.getByRole(`button`, { name: `New session` }).click()
  await page.getByRole(`button`, { name: /^coding-agent/ }).click()
}

export async function makeTmpWorkspace(): Promise<{
  path: string
  realPath: string
}> {
  const path = await mkdtemp(join(tmpdir(), `pw-ws-`))
  return { path, realPath: await realpath(path) }
}

export async function seedHostSession(
  workspaceRealPath: string,
  sessionId: string,
  content: string,
  homeDir: string = homedir()
): Promise<string> {
  const sanitised = workspaceRealPath.replace(/\//g, `-`)
  const projectDir = join(homeDir, `.claude`, `projects`, sanitised)
  await mkdir(projectDir, { recursive: true })
  const filePath = join(projectDir, `${sessionId}.jsonl`)
  await writeFile(filePath, content)
  return filePath
}

export async function rmIfExists(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true })
}

export async function spawnEntity(
  request: APIRequestContext,
  name: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await request.put(`${SERVER_BASE}/coding-agent/${name}`, {
    data: body,
  })
  if (!res.ok()) {
    throw new Error(
      `spawn failed: ${res.status()} ${await res.text().catch(() => ``)}`
    )
  }
}

/**
 * Send a pin message to wake the handler so first-wake init runs (sessionMeta
 * populated, import flow executed). Avoids invoking claude — pin is a no-op
 * inbox message that just triggers the handler.
 *
 * Polls before sending: PUT /coding-agent/<name> returns once the entity
 * row is durable, but the handler registration (which can dispatch our
 * `pin` payload) lands on a separate path. Several specs raced
 * `spawn → pin → goto → assert` and saw the timeline empty because the
 * pin landed before init wiring was complete. We poll up to 5 s waiting
 * for GET /coding-agent/<name>/sessionMeta to return a row, then fire
 * the pin.
 */
export async function wakeHandlerWithPin(
  request: APIRequestContext,
  name: string
): Promise<void> {
  await waitForEntityReady(request, name, 5_000)
  const res = await request.post(`${SERVER_BASE}/coding-agent/${name}/send`, {
    data: { from: `e2e-test`, type: `pin`, payload: {} },
  })
  if (!res.ok()) {
    throw new Error(
      `pin failed: ${res.status()} ${await res.text().catch(() => ``)}`
    )
  }
}

/**
 * Polls `GET /coding-agent/<name>` until it returns 200 (entity is
 * registered and discoverable) or the deadline elapses. Returns
 * silently — callers that need a stricter ready signal can chain
 * additional polling on collection rows.
 */
async function waitForEntityReady(
  request: APIRequestContext,
  name: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await request
      .get(`${SERVER_BASE}/coding-agent/${name}`)
      .catch(() => null)
    if (res && res.ok()) return
    await new Promise((r) => setTimeout(r, 100))
  }
}

export async function spawnAndWake(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown>
): Promise<void> {
  await spawnEntity(request, name, { args })
  await wakeHandlerWithPin(request, name)
}

/**
 * Convenience wrapper around spawnAndWake that returns the canonical agent
 * url (e.g. `/coding-agent/<name>`) so callers can chain it into UI flows or
 * subsequent fork operations without hard-coding the prefix.
 */
export async function spawnCodingAgent(
  request: APIRequestContext,
  args: Record<string, unknown>,
  prefix = `pw-`
): Promise<{ name: string; url: string }> {
  const name = uniqueAgentName(prefix)
  await spawnAndWake(request, name, args)
  return { name, url: `/coding-agent/${name}` }
}

export async function deleteEntity(
  request: APIRequestContext,
  name: string
): Promise<void> {
  await request
    .delete(`${SERVER_BASE}/coding-agent/${name}`)
    .catch(() => undefined)
}
