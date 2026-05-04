// Layer 4 e2e — opencode resume (real CLI, against a running agents-server).
//
// Plan-deviation: the original plan gated this on SLOW=1 + ANTHROPIC_API_KEY
// and used `anthropic/claude-haiku-4-5` as the probe model. Phase 3
// reconnaissance found the local opencode auth fixture only had the
// openai provider configured, so for consistency across the slice
// (conformance + e2e) the probe model is `openai/gpt-5.4-mini-fast`
// and the gate is OPENAI_API_KEY.
import { afterAll, describe, expect, it } from 'vitest'

const SLOW = process.env.SLOW === `1` && !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`E7 — opencode resume (real CLI, e2e)`, () => {
  const agentId = `e2e-opencode-resume-${Date.now().toString(36)}`
  const SECRET = `MAGNOLIA`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`turn 2 recalls a secret from turn 1 via opencode --continue / -s`, async () => {
    // Spawn opencode.
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: {
          kind: `opencode`,
          workspaceType: `volume`,
          model: `openai/gpt-5.4-mini-fast`,
        },
      }),
    })

    // Turn 1: tell the secret.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `the magic word is ${SECRET}. just acknowledge.` },
      }),
    })
    await waitForRunCount(agentId, 1, 120_000)

    // Turn 2: recall.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `what was the magic word? answer in one word.` },
      }),
    })
    const w = await waitForRunCount(agentId, 2, 180_000)
    expect((w.responseText ?? ``).toLowerCase()).toContain(SECRET.toLowerCase())
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
      // Stream may not exist yet immediately after PUT — server returns
      // 'Stream not found'. Treat any non-JSON body as 'keep polling'.
      let data: Array<any> | null = null
      try {
        data = JSON.parse(txt) as Array<any>
      } catch {
        data = null
      }
      if (data) {
        const completed = data
          .filter((e) => e.type === `coding-agent.runs`)
          .map((e) => e.value)
          .filter((v) => v.status === `completed` && v.key !== `imported`)
        if (completed.length >= minCount) {
          return completed[completed.length - 1]
        }
      }
    } catch {
      // network blip — fall through to retry.
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(
    `timeout waiting for ${minCount} run(s) completed on ${agentId}`
  )
}
