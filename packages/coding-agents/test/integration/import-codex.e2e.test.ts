import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const SLOW = process.env.SLOW === `1` && !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip

d(`E1 — codex native session import (e2e)`, () => {
  const SESSION_ID = `019${Date.now().toString(36)}-codex-import`
  const SECRET = `PINEAPPLE`
  const SERVER = `http://localhost:4437`
  let codexFile: string

  beforeAll(async () => {
    const now = new Date()
    const dateDir = join(
      process.env.HOME!,
      `.codex`,
      `sessions`,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, `0`),
      String(now.getUTCDate()).padStart(2, `0`)
    )
    await mkdir(dateDir, { recursive: true })
    const ts = now.toISOString().replace(/[:.]/g, `-`).slice(0, 19)
    codexFile = join(dateDir, `rollout-${ts}-${SESSION_ID}.jsonl`)
    const lines =
      [
        JSON.stringify({
          type: `thread.started`,
          thread_id: SESSION_ID,
          timestamp: now.toISOString(),
        }),
        JSON.stringify({
          type: `item.completed`,
          item: {
            id: `i0`,
            type: `agent_message`,
            text: `the secret word is ${SECRET}`,
          },
        }),
        JSON.stringify({ type: `turn.completed`, usage: {} }),
      ].join(`\n`) + `\n`
    await writeFile(codexFile, lines)
  })

  afterAll(async () => {
    await rm(codexFile, { force: true })
  })

  it(`imports + backfills events + resumes correctly`, async () => {
    const agentId = `e2e-codex-${Date.now().toString(36)}`
    const importBin = join(__dirname, `..`, `..`, `dist`, `cli`, `import.js`)
    const { stdout } = await execFileP(`node`, [
      importBin,
      `--agent`,
      `codex`,
      `--workspace`,
      process.cwd(),
      `--session-id`,
      SESSION_ID,
      `--server`,
      SERVER,
      `--agent-id`,
      agentId,
    ])
    expect(stdout).toContain(`imported as /coding-agent/${agentId}`)

    const deadline = Date.now() + 20_000
    let meta: any
    while (Date.now() < deadline) {
      const res = await fetch(
        `${SERVER}/coding-agent/${agentId}/main?offset=-1`
      )
      const data = (await res.json()) as Array<any>
      const metas = data.filter((e) => e.type === `coding-agent.sessionMeta`)
      if (metas.length > 0) {
        meta = metas[metas.length - 1].value
        if (meta.nativeSessionId === SESSION_ID) break
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(meta?.nativeSessionId).toBe(SESSION_ID)

    const data = (await (
      await fetch(`${SERVER}/coding-agent/${agentId}/main?offset=-1`)
    ).json()) as Array<any>
    const assistantTexts = data
      .filter((e) => e.type === `coding-agent.events`)
      .map((e) => e.value)
      .filter((v) => v.type === `assistant_message`)
      .map((v) => (v.payload as any)?.text ?? ``)
    expect(assistantTexts.some((t) => t.includes(SECRET))).toBe(true)

    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `what was the secret? one word.` },
      }),
    })

    const runDeadline = Date.now() + 120_000
    while (Date.now() < runDeadline) {
      const res = await fetch(
        `${SERVER}/coding-agent/${agentId}/main?offset=-1`
      )
      const data = (await res.json()) as Array<any>
      const completedRuns = data
        .filter((e) => e.type === `coding-agent.runs`)
        .map((e) => e.value)
        .filter((r) => r.status === `completed` && r.key !== `imported`)
      if (completedRuns.length > 0) {
        const text = (
          completedRuns[completedRuns.length - 1].responseText ?? ``
        ).toLowerCase()
        expect(text).toContain(SECRET.toLowerCase())
        return
      }
      await new Promise((r) => setTimeout(r, 1_000))
    }
    throw new Error(`timeout waiting for follow-up run`)
  }, 180_000)
})
