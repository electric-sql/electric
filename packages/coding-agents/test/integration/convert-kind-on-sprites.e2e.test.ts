// Layer 4 e2e — claude → codex convert on Fly Sprites (real, against
// a running agents-server). Gated SLOW=1 + SPRITES_TOKEN +
// ANTHROPIC_API_KEY + OPENAI_API_KEY.
//
// 240s waitForRunCount timeout per turn because sprites cold-boot +
// bootstrap is much longer than local docker.
import { afterAll, describe, expect, it } from 'vitest'

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.SPRITES_TOKEN &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`Sprites — claude → codex convert (real, e2e)`, () => {
  const agentId = `e2e-sprites-convert-${Date.now().toString(36)}`
  const SECRET = `BUTTERFLY-${Date.now().toString(36).slice(-4)}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`claude turn → convert to codex → codex recalls secret`, async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: { kind: `claude`, target: `sprites`, workspaceType: `volume` },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `the secret word is ${SECRET}. Just acknowledge.` },
      }),
    })
    await waitForRunCount(agentId, 1, 240_000)

    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `convert-kind`,
        payload: { kind: `codex` },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `In one word, what is the secret word?` },
      }),
    })

    const w2 = await waitForRunCount(agentId, 2, 240_000)
    expect((w2.responseText ?? ``).toLowerCase()).toContain(
      SECRET.toLowerCase()
    )
  }, 600_000)
})

// waitForRunCount helper — paste from spawn-sprites-claude.e2e.test.ts.
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
      /* transient */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run count >= ${minCount}`)
}
