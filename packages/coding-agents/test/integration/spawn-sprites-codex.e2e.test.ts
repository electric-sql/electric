// Layer 4 e2e — codex spawn on Fly Sprites (real, against a running
// agents-server). Gated SLOW=1 + SPRITES_TOKEN + OPENAI_API_KEY.
//
// 240s waitForRunCount timeout because sprites cold-boot + first-prompt
// bootstrap (~10-30s) is much longer than local docker.
import { afterAll, describe, expect, it } from 'vitest'

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.SPRITES_TOKEN &&
  !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`Sprites — codex spawn (real, e2e)`, () => {
  const agentId = `e2e-sprites-codex-${Date.now().toString(36)}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`spawns codex on sprites + reply with ok`, async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: { kind: `codex`, target: `sprites`, workspaceType: `volume` },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `Reply with the single word: ok` },
      }),
    })
    const w = await waitForRunCount(agentId, 1, 240_000)
    expect((w.responseText ?? ``).toLowerCase()).toMatch(/ok/i)
  }, 360_000)
})

async function waitForRunCount(
  agentId: string,
  minCount: number,
  ms: number
): Promise<{ responseText?: string }> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const r = await fetch(
        `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
      )
      const txt = await r.text()
      let data: Array<any> | null = null
      try {
        data = JSON.parse(txt) as Array<any>
      } catch {
        /* keep polling */
      }
      if (data) {
        const completed = data
          .filter((e) => e.type === `coding-agent.runs`)
          .map((e) => e.value)
          .filter((v) => v.status === `completed` && v.key !== `imported`)
        if (completed.length >= minCount) return completed[completed.length - 1]
      }
    } catch {
      /* transient — keep polling */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run count >= ${minCount}`)
}
