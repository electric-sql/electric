import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SLOW = process.env.SLOW === `1` && !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`E3 — codex tool execution + workspace side-effect (e2e)`, () => {
  const cleanups: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c().catch(() => undefined)
  })

  it(`creates hello.txt with 'world' and emits tool_call/tool_result events`, async () => {
    const ws = await mkdtemp(join(tmpdir(), `tool-codex-e2e-`))
    cleanups.push(() => rm(ws, { recursive: true, force: true }))
    const agentId = `e2e-tool-codex-${Date.now().toString(36)}`

    await fetch(`${SERVER}/coding-agent/${agentId}`, {
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
          text: `create a file called hello.txt with the single word 'world'. then reply with: done.`,
        },
      }),
    })

    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      const data = (await (
        await fetch(`${SERVER}/coding-agent/${agentId}/main?offset=-1`)
      ).json()) as Array<any>
      const completed = data
        .filter((e) => e.type === `coding-agent.runs`)
        .map((e) => e.value)
        .filter((r) => r.status === `completed`)
      if (completed.length >= 1) {
        const events = data
          .filter((e) => e.type === `coding-agent.events`)
          .map((e) => e.value)
        const toolCall = events.find(
          (e) =>
            e.type === `tool_call` &&
            /write|edit|apply_patch|function_call/i.test(
              JSON.stringify(e.payload ?? ``)
            )
        )
        expect(toolCall).toBeDefined()
        const toolResult = events.find(
          (e) =>
            e.type === `tool_result` && (e.payload as any)?.isError === false
        )
        expect(toolResult).toBeDefined()
        const fileContent = await readFile(join(ws, `hello.txt`), `utf8`)
        expect(fileContent.toLowerCase()).toContain(`world`)
        return
      }
      await new Promise((r) => setTimeout(r, 1_000))
    }
    throw new Error(`turn never completed`)
  }, 240_000)
})
