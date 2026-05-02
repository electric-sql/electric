import { describe, expect, it } from 'vitest'
import type { NormalizedEvent } from 'agent-session-protocol'
import { convertNativeJsonl } from '../../src/entity/conversion'

describe(`convertNativeJsonl`, () => {
  const sample: Array<NormalizedEvent> = [
    {
      type: `session_init`,
      ts: 1_700_000_000_000,
      sessionId: `old-id`,
      cwd: `/old/cwd`,
    } as NormalizedEvent,
    {
      type: `user_message`,
      ts: 1_700_000_001_000,
      text: `hello`,
    } as NormalizedEvent,
    {
      type: `assistant_message`,
      ts: 1_700_000_002_000,
      text: `world`,
    } as NormalizedEvent,
    {
      type: `turn_complete`,
      ts: 1_700_000_003_000,
      durationMs: 2000,
    } as NormalizedEvent,
  ]

  it(`returns content + sessionId for codex`, () => {
    const r = convertNativeJsonl(sample, `codex`, {
      sessionId: `new-codex-id-123`,
      cwd: `/new/cwd`,
    })
    expect(r.sessionId).toBe(`new-codex-id-123`)
    expect(r.content.length).toBeGreaterThan(0)
    // Codex transcripts use timestamp + payload shape — assert the new
    // session id appears in the first line.
    const firstLine = r.content.split(`\n`)[0]!
    expect(firstLine).toContain(`new-codex-id-123`)
  })

  it(`returns content + sessionId for claude`, () => {
    const r = convertNativeJsonl(sample, `claude`, {
      sessionId: `new-claude-id-abc`,
      cwd: `/new/cwd`,
    })
    expect(r.sessionId).toBe(`new-claude-id-abc`)
    expect(r.content).toContain(`new-claude-id-abc`)
  })

  it(`empty events → empty content`, () => {
    const r = convertNativeJsonl([], `claude`, {
      sessionId: `x`,
      cwd: `/y`,
    })
    expect(r.sessionId).toBe(`x`)
    expect(r.content).toBe(``)
  })
})
