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

export async function deleteEntity(
  request: APIRequestContext,
  name: string
): Promise<void> {
  await request
    .delete(`${SERVER_BASE}/coding-agent/${name}`)
    .catch(() => undefined)
}
