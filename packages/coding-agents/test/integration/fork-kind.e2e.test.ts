import { afterAll, describe, expect, it } from 'vitest'

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

// Lightweight id generator — avoids pulling nanoid in just for tests.
function shortId(): string {
  return Math.random().toString(36).slice(2, 8)
}

d(`E5 — fork claude → codex (real CLIs, e2e)`, () => {
  const sourceId = `e2e-fork-src-${Date.now().toString(36)}`
  const forkId = `e2e-fork-${shortId()}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${sourceId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
    await fetch(`${SERVER}/coding-agent/${forkId}`, { method: `DELETE` }).catch(
      () => undefined
    )
  })

  it(`source claude run → fork as codex → fork sees prior context`, async () => {
    // Spawn source. Spawn shape (real API): PUT /coding-agent/<name>
    // with { args: {...} }. The plan's example used a stale
    // `{ id, creationArgs: {...} }` shape; adapted here to match the
    // live HTTP route.
    await fetch(`${SERVER}/coding-agent/${sourceId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: { kind: `claude`, workspaceType: `volume` },
      }),
    })
    const KEY = `MAGNOLIA`
    await fetch(`${SERVER}/coding-agent/${sourceId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `the magic word is ${KEY}. acknowledge.` },
      }),
    })
    await waitForLastRunCompleted(sourceId, 120_000)

    // Fork as codex.
    await fetch(`${SERVER}/coding-agent/${forkId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: {
          kind: `codex`,
          workspaceType: `volume`,
          fromAgentId: `/coding-agent/${sourceId}`,
          fromWorkspaceMode: `share`,
        },
      }),
    })
    // PUT alone doesn't fire first-wake init — the runtime needs a fresh
    // wake input. Send a lifecycle/init nudge (same pattern as import CLI).
    await fetch(`${SERVER}/coding-agent/${forkId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `lifecycle/init`,
        payload: {},
      }),
    })
    await waitForLifecycleEvent(forkId, `kind.forked`, 30_000)

    // Ask the fork for the magic word.
    await fetch(`${SERVER}/coding-agent/${forkId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: {
          text: `what was the magic word from earlier? answer in one word.`,
        },
      }),
    })
    const w = await waitForLastRunCompleted(forkId, 180_000)
    expect((w.responseText ?? ``).toLowerCase()).toContain(KEY.toLowerCase())
  }, 420_000)
})

// Reuse the same helpers as convert-kind.e2e.test.ts (paste here or
// extract into test/support/e2e-helpers.ts in a follow-up).
async function waitForLastRunCompleted(
  agentId: string,
  ms: number
): Promise<{ responseText?: string }> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const r = await fetch(
      `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
    )
    const data = (await r.json()) as Array<any>
    const completed = data
      .filter((e) => e.type === `coding-agent.runs`)
      .map((e) => e.value)
      .filter((v) => v.status === `completed` && v.key !== `imported`)
    if (completed.length > 0) return completed[completed.length - 1]
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run completion`)
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
