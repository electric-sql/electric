// Layer 4 e2e — claude → codex fork on Fly Sprites (real, against
// a running agents-server). Source claude on sprites; fork to codex
// (target stays sprites — cross-provider fork is rejected). Verifies
// the fork recalls source's conversation.
//
// Gated SLOW=1 + SPRITES_TOKEN + ANTHROPIC_API_KEY + OPENAI_API_KEY.
// 360s timeout for the fork's first turn because spawn + bootstrap on
// sprites is much longer than local docker.
import { afterAll, describe, expect, it } from 'vitest'

// Lightweight id generator — avoids pulling nanoid in just for tests
// (matches fork-kind.e2e.test.ts; the plan template referenced nanoid
// but the package.json doesn't pull it as a direct dep).
function shortId(): string {
  return Math.random().toString(36).slice(2, 8)
}

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.SPRITES_TOKEN &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`Sprites — claude → codex fork (real, e2e)`, () => {
  const sourceId = `e2e-sprites-fork-src-${Date.now().toString(36)}`
  const forkId = `e2e-sprites-fork-${shortId()}`
  const SECRET = `MAGNOLIA-${Date.now().toString(36).slice(-4)}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${sourceId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
    await fetch(`${SERVER}/coding-agent/${forkId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`source claude run → fork as codex on sprites → fork recalls`, async () => {
    await fetch(`${SERVER}/coding-agent/${sourceId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: { kind: `claude`, target: `sprites`, workspaceType: `volume` },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${sourceId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `the secret word is ${SECRET}. Just acknowledge.` },
      }),
    })
    await waitForRunCount(sourceId, 1, 240_000)

    // Spawn fork (target=sprites; fromAgentId points at source).
    await fetch(`${SERVER}/coding-agent/${forkId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: {
          kind: `codex`,
          target: `sprites`,
          workspaceType: `volume`,
          fromAgentId: `/coding-agent/${sourceId}`,
          fromWorkspaceMode: `share`, // workspace files don't transfer in v1; mode is informational
        },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${forkId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `In one word, what is the secret word?` },
      }),
    })

    const w = await waitForRunCount(forkId, 1, 360_000)
    expect((w.responseText ?? ``).toLowerCase()).toContain(SECRET.toLowerCase())
  }, 720_000)
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
      /* transient */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run count >= ${minCount}`)
}
