import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SLOW = process.env.SLOW === `1` && !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`E2 — codex resume materialise (e2e)`, () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c().catch(() => undefined)
  })

  it(`turn 2 references turn 1 content via materialise path`, async () => {
    const ws = await mkdtemp(join(tmpdir(), `codex-resume-e2e-`))
    cleanups.push(() => rm(ws, { recursive: true, force: true }))
    const agentId = `e2e-codex-resume-${Date.now().toString(36)}`
    const SECRET = `MAGENTA`

    const spawnRes = await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: {
          kind: `codex`,
          target: `host`,
          workspaceType: `bindMount`,
          workspaceHostPath: ws,
        },
        initialMessage: {
          text: `remember the word ${SECRET}. reply with: OK`,
        },
      }),
    })
    expect(spawnRes.status).toBe(201)

    const t1Deadline = Date.now() + 120_000
    while (Date.now() < t1Deadline) {
      const data = (await (
        await fetch(`${SERVER}/coding-agent/${agentId}/main?offset=-1`)
      ).json()) as Array<any>
      const completed = data
        .filter((e) => e.type === `coding-agent.runs`)
        .map((e) => e.value)
        .filter((r) => r.status === `completed`)
      if (completed.length >= 1) break
      await new Promise((r) => setTimeout(r, 1_000))
    }

    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ from: `e2e`, type: `stop`, payload: {} }),
    })

    const coldDeadline = Date.now() + 30_000
    while (Date.now() < coldDeadline) {
      const data = (await (
        await fetch(`${SERVER}/coding-agent/${agentId}/main?offset=-1`)
      ).json()) as Array<any>
      const meta = data
        .filter((e) => e.type === `coding-agent.sessionMeta`)
        .map((e) => e.value)
        .pop()
      if (meta?.status === `cold`) break
      await new Promise((r) => setTimeout(r, 500))
    }

    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `what word should you remember?` },
      }),
    })

    const t2Deadline = Date.now() + 120_000
    while (Date.now() < t2Deadline) {
      const data = (await (
        await fetch(`${SERVER}/coding-agent/${agentId}/main?offset=-1`)
      ).json()) as Array<any>
      const completed = data
        .filter((e) => e.type === `coding-agent.runs`)
        .map((e) => e.value)
        .filter((r) => r.status === `completed`)
      if (completed.length >= 2) {
        const text = (
          completed[completed.length - 1].responseText ?? ``
        ).toUpperCase()
        expect(text).toContain(SECRET)
        return
      }
      await new Promise((r) => setTimeout(r, 1_000))
    }
    throw new Error(`turn 2 never completed`)
  }, 360_000)
})
