// Layer-4 wiring smoke test for the sprites provider.
//
// Why this exists: previous slice merges shipped two wiring bugs that all
// existing tests missed —
//   (1) packages/agents/src/bootstrap.ts didn't pass `sprites` into
//       registerCodingAgent's `providers` map (the type was inner-only),
//       so the handler started without a sprites provider even when
//       SPRITES_TOKEN was set;
//   (2) FlySpriteProvider's spriteName() left agent ids mixed-case, but
//       the live sprites.dev API rejects anything not matching [a-z0-9-]+
//       with HTTP 400 'invalid sprite name format'.
//
// Both bugs only manifest end-to-end against (a) the real dev server and
// (b) the live Sprites API. Conformance fixtures bypass bootstrap.ts and
// the existing Playwright spec stubs out the spawn PUT, so neither layer
// catches these. This test exercises the full path: PUT spawn against
// a running agents-server on :4437, send a prompt, then check the
// agent's sessionMeta.lastError for the two wiring-class signatures.
//
// We deliberately do NOT require ANTHROPIC/OPENAI keys: providerFor and
// FlySpriteProvider.start() both run before any LLM call, so a wiring
// regression flips lastError before the LLM is reached.
//
// Gated SPRITES=1 + SPRITES_TOKEN. Idle teardown deletes the entity and
// best-effort deletes the sprite via the live API.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SpritesApiClient } from '../../src/providers/fly-sprites/api-client'

const SLOW = process.env.SPRITES === `1` && !!process.env.SPRITES_TOKEN
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`sprites wiring (live dev server + live Sprites API)`, () => {
  const agentId = `e2e-sprites-wiring-${Date.now().toString(36)}`
  const spriteClient = new SpritesApiClient({
    token: process.env.SPRITES_TOKEN!,
  })

  beforeAll(async () => {
    const res = await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: { kind: `claude`, target: `sprites`, workspaceType: `volume` },
      }),
    })
    // PUT must succeed — a 422 here means the registered creation_schema
    // doesn't include 'sprites' in the target enum. That is the
    // "stale dist on the handler" bug class.
    expect(
      res.ok,
      `spawn PUT failed (${res.status}). Likely cause: handler's @electric-ax/coding-agents dist is stale and registered creation_schema.target.enum doesn't include 'sprites'. Rebuild + restart dev services.`
    ).toBe(true)
  }, 30_000)

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
    // Best-effort delete the actual sprite. Name is the lowercased,
    // sanitised agentId prefixed with 'coding-agent-'.
    const spriteName = `coding-agent-${agentId.toLowerCase().replace(/[^a-z0-9-]/g, `-`)}`
    await spriteClient.deleteSprite(spriteName).catch(() => undefined)
  })

  it(`provider is wired (no 'No provider configured for target=sprites' error after a prompt)`, async () => {
    // Send a prompt to wake the handler and trigger lm.providerFor('sprites').
    // We don't care whether the LLM call succeeds — only whether the wiring
    // signal appears in lastError before we time out.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `reply with the single word ok` },
      }),
    })

    const lastError = await waitForOneOf(agentId, 60_000, [
      // Pass signals — wiring works, we got past providerFor and into
      // the actual sprite lifecycle.
      { kind: `lifecycle`, event: `bootstrap.starting` },
      { kind: `lifecycle`, event: `sandbox.started` },
      { kind: `meta-status`, status: `idle` },
      { kind: `meta-status`, status: `running` },
      // Fail signals — the bug-classes we want this test to catch.
      {
        kind: `lastError`,
        match: /No provider configured for target=['"]?sprites/i,
      },
      {
        kind: `lastError`,
        match: /invalid sprite name format/i,
      },
    ])

    // If lastError is set AND it matches a known wiring-class regression,
    // fail with a pointed message.
    if (lastError) {
      throw new Error(
        `WIRING-CLASS REGRESSION DETECTED.\n` +
          `lastError: ${lastError}\n` +
          `Likely causes:\n` +
          `  - 'No provider configured': bootstrap.ts didn't pass providers.sprites; check createSpritesProviderIfConfigured() wire-up.\n` +
          `  - 'invalid sprite name format': spriteName() produced an invalid name; check [a-z0-9-]+ sanitisation.`
      )
    }
  }, 90_000)
})

interface PassPattern {
  kind: `lifecycle` | `meta-status` | `lastError`
  event?: string
  status?: string
  match?: RegExp
}

/**
 * Polls /coding-agent/<id>/main until one of the patterns matches.
 * Returns:
 *   - undefined if a pass-pattern fired (lifecycle/meta-status)
 *   - the lastError string if the lastError pattern fired
 *   - throws on timeout
 */
async function waitForOneOf(
  agentId: string,
  ms: number,
  patterns: Array<PassPattern>
): Promise<string | undefined> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${SERVER}/coding-agent/${agentId}/main?offset=-1`)
      const data = (await r.json()) as Array<any>
      // Pass-pattern: any lifecycle row with a matching event.
      for (const p of patterns) {
        if (p.kind === `lifecycle` && p.event) {
          const has = data
            .filter((e) => e.type === `coding-agent.lifecycle`)
            .map((e) => e.value)
            .some((v) => v.event === p.event)
          if (has) return undefined
        }
        if (p.kind === `meta-status` && p.status) {
          const has = data
            .filter((e) => e.type === `coding-agent.sessionMeta`)
            .map((e) => e.value)
            .some((v) => v.status === p.status)
          if (has) return undefined
        }
      }
      // Fail-pattern: lastError matches a known wiring-class signature.
      const lastError = data
        .filter((e) => e.type === `coding-agent.sessionMeta`)
        .map((e) => e.value)
        .reduce<string | undefined>(
          (acc, v) => (v.lastError ? v.lastError : acc),
          undefined
        )
      if (lastError) {
        for (const p of patterns) {
          if (p.kind === `lastError` && p.match && p.match.test(lastError)) {
            return lastError
          }
        }
      }
    } catch {
      // transient — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(
    `timeout waiting for wiring signal on ${agentId} after ${ms}ms`
  )
}
