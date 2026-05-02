import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const SLOW = process.env.SLOW === `1` && !!process.env.ANTHROPIC_API_KEY
const d = SLOW ? describe : describe.skip

d(`E1 — claude native session import (e2e)`, () => {
  let workspace: string
  let claudeProjectDir: string
  const SESSION_ID = `e2e-import-claude-${Date.now().toString(36)}`
  const SECRET = `ELEPHANT`
  const SERVER = `http://localhost:4437`

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), `import-claude-e2e-`))
    const sanitised = workspace.replace(/\//g, `-`)
    claudeProjectDir = join(process.env.HOME!, `.claude`, `projects`, sanitised)
    await mkdir(claudeProjectDir, { recursive: true })
    const lines =
      [
        JSON.stringify({
          type: `system`,
          subtype: `init`,
          session_id: SESSION_ID,
          cwd: workspace,
        }),
        JSON.stringify({
          type: `user`,
          message: { content: [{ type: `text`, text: `remember the secret` }] },
          session_id: SESSION_ID,
        }),
        JSON.stringify({
          type: `assistant`,
          message: {
            content: [{ type: `text`, text: `the secret word is ${SECRET}` }],
          },
          session_id: SESSION_ID,
        }),
      ].join(`\n`) + `\n`
    await writeFile(join(claudeProjectDir, `${SESSION_ID}.jsonl`), lines)
  })

  afterAll(async () => {
    await rm(join(claudeProjectDir, `${SESSION_ID}.jsonl`), { force: true })
    await rm(workspace, { recursive: true, force: true })
  })

  it(`imports + backfills events + resumes correctly`, async () => {
    const agentId = `e2e-claude-${Date.now().toString(36)}`
    const importBin = join(__dirname, `..`, `..`, `dist`, `cli`, `import.js`)
    const { stdout } = await execFileP(`node`, [
      importBin,
      `--agent`,
      `claude`,
      `--workspace`,
      workspace,
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

    const finalRes = await fetch(
      `${SERVER}/coding-agent/${agentId}/main?offset=-1`
    )
    const finalData = (await finalRes.json()) as Array<any>
    const eventRows = finalData.filter((e) => e.type === `coding-agent.events`)
    const assistantTexts = eventRows
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
        payload: { text: `what was the secret word? answer in one word.` },
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
    throw new Error(`timeout waiting for follow-up run to complete`)
  }, 180_000)
})
