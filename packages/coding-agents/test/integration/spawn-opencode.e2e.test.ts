// Layer 4 e2e — opencode spawn (real CLI, against a running agents-server).
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

d(`E6 — opencode spawn (real CLI, e2e)`, () => {
  const agentId = `e2e-opencode-${Date.now().toString(36)}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`spawns opencode + replies to a prompt`, async () => {
    // Spawn (live API: PUT /coding-agent/<name> with { args }).
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

    // Send the prompt.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `Reply with the single word: ok` },
      }),
    })

    // Wait for run completion.
    const w = await waitForLastRunCompleted(agentId, 120_000)
    expect((w.responseText ?? ``).toLowerCase()).toMatch(/ok/i)
  }, 180_000)
})

async function waitForLastRunCompleted(
  agentId: string,
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
        if (completed.length > 0) return completed[completed.length - 1]
      }
    } catch {
      // network blip — fall through to retry.
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run completion`)
}
