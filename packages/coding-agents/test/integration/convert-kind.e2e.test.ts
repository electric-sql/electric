import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`E4 — claude → codex convert (real CLIs, e2e)`, () => {
  const agentId = `e2e-convert-${Date.now().toString(36)}`
  const SECRET = `BUTTERFLY`

  beforeAll(async () => {
    // Spawn a claude coding-agent.
    // Spawn shape (real API): PUT /coding-agent/<name> with { args: {...} }.
    // The plan's example used a stale `{ id, creationArgs: {...} }` shape;
    // adapted here to match the live HTTP route.
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: { kind: `claude`, workspaceType: `volume` },
      }),
    })
  })

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`claude turn → convert to codex → codex recalls secret`, async () => {
    // Turn 1: tell the agent a secret under claude.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `the secret word is ${SECRET}. just acknowledge.` },
      }),
    })

    // Wait for turn 1 to complete (count >= 1).
    await waitForRunCount(agentId, 1, 120_000)

    // Convert to codex.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `convert-kind`,
        payload: { kind: `codex` },
      }),
    })
    // Wait briefly for the conversion lifecycle row.
    await waitForLifecycleEvent(agentId, `kind.converted`, 10_000)

    // Turn 2 under codex: ask for the secret.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `what was the secret word? answer in one word.` },
      }),
    })

    // Wait for turn 2 specifically (count >= 2) so we don't race-pick
    // turn 1's responseText if convert + codex's first turn haven't
    // landed yet.
    const w2 = await waitForRunCount(agentId, 2, 180_000)
    expect((w2.responseText ?? ``).toLowerCase()).toContain(
      SECRET.toLowerCase()
    )
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
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run count >= ${minCount} on ${agentId}`)
}

async function waitForLifecycleEvent(
  agentId: string,
  event: string,
  ms: number
): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const r = await fetch(
      `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
    )
    const data = (await r.json()) as Array<any>
    const has = data
      .filter((e) => e.type === `coding-agent.lifecycle`)
      .map((e) => e.value)
      .some((v) => v.event === event)
    if (has) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timeout waiting for lifecycle event ${event}`)
}
