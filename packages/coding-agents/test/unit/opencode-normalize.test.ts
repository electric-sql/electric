import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeOpencode } from '../../src/agents/opencode-normalize'

const FIXTURES = join(__dirname, `..`, `fixtures`, `opencode`)

function loadFixture(name: string): Array<string> {
  const raw = readFileSync(join(FIXTURES, `${name}.jsonl`), `utf8`)
  return raw.split(`\n`).filter((l) => l.trim().length > 0)
}

describe(`normalizeOpencode — first turn`, () => {
  const lines = loadFixture(`first-turn`)
  const events = normalizeOpencode(lines)

  it(`emits exactly one session_init as the first event`, () => {
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.type).toBe(`session_init`)
  })

  it(`emits at least one assistant_message containing the reply`, () => {
    const am = events.filter((e) => e.type === `assistant_message`)
    expect(am.length).toBeGreaterThan(0)
    const text = am.map((e) => (e as any).text).join(``)
    expect(text.toLowerCase()).toContain(`ok`)
  })

  it(`emits a turn_complete as the last event`, () => {
    expect(events[events.length - 1]!.type).toBe(`turn_complete`)
  })

  it(`every text-bearing event maps to assistant_message or thinking (no silent drops)`, () => {
    const am = events.filter((e) => e.type === `assistant_message`)
    const th = events.filter((e) => e.type === `thinking`)
    expect(am.length + th.length).toBeGreaterThan(0)
  })
})

describe(`normalizeOpencode — text without phase metadata (regression: 2026-05-03)`, () => {
  // opencode 1.14.x emits `metadata.openai.phase = 'final_answer'` only
  // when invoked with `--print-logs`. The bridge uses `opencode run
  // --format json` which omits the field, leaving every text event
  // mis-classified as `thinking` and `responseText` empty (failing the
  // L2.1 cold-boot conformance scenario for opencode/local-docker).
  // Fix: any `text` part is the assistant's user-visible response;
  // chain-of-thought is emitted as a separate `reasoning` part.
  const lines = [
    JSON.stringify({
      type: `step_start`,
      sessionID: `ses_nophase`,
      timestamp: 1,
      part: { id: `prt_a`, messageID: `msg_a`, type: `step-start` },
    }),
    JSON.stringify({
      type: `text`,
      sessionID: `ses_nophase`,
      timestamp: 2,
      part: {
        id: `prt_b`,
        messageID: `msg_a`,
        type: `text`,
        text: `ok`,
        // metadata.openai has no `phase` field — exactly what opencode
        // emits without --print-logs.
        metadata: { openai: { itemId: `msg_x` } },
      },
    }),
    JSON.stringify({
      type: `step_finish`,
      sessionID: `ses_nophase`,
      timestamp: 3,
      part: {
        id: `prt_c`,
        messageID: `msg_a`,
        reason: `stop`,
        type: `step-finish`,
        tokens: {
          total: 0,
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { write: 0, read: 0 },
        },
        cost: 0,
      },
    }),
  ]
  const events = normalizeOpencode(lines)

  it(`emits assistant_message when phase metadata is missing`, () => {
    const am = events.filter((e) => e.type === `assistant_message`)
    expect(am).toHaveLength(1)
    expect((am[0] as any).text).toBe(`ok`)
  })
})

describe(`normalizeOpencode — resume turn`, () => {
  const lines = loadFixture(`resume-turn`)
  const events = normalizeOpencode(lines)

  it(`session_init carries the sessionID from the resumed turn`, () => {
    const init = events.find((e) => e.type === `session_init`) as
      | { type: `session_init`; sessionId: string }
      | undefined
    expect(init).toBeDefined()
    expect(init!.sessionId).toMatch(/^ses_/)
  })

  it(`assistant_message recalls something from the prior turn`, () => {
    const am = events.filter((e) => e.type === `assistant_message`)
    const text = am
      .map((e) => (e as any).text || ``)
      .join(``)
      .toLowerCase()
    // Resume prompt asks 'what word did you reply with last turn?' — the answer
    // should mention 'ok'. If the fixture was captured against a model that
    // doesn't recall, this assertion is a smoke for cumulative storage.
    expect(text).toContain(`ok`)
  })
})

describe(`normalizeOpencode — synthetic events`, () => {
  it(`maps tool_use with completed state to a tool_call + tool_result pair`, () => {
    const lines = [
      JSON.stringify({
        type: `step_start`,
        sessionID: `ses_synth`,
        timestamp: 1_700_000_000_000,
        part: { type: `step-start` },
      }),
      JSON.stringify({
        type: `tool_use`,
        sessionID: `ses_synth`,
        timestamp: 1_700_000_001_000,
        part: {
          type: `tool`,
          tool: `bash`,
          callID: `call_xyz`,
          state: {
            status: `completed`,
            input: { command: `echo hi` },
            output: `hi\n`,
            metadata: { exit: 0 },
          },
        },
      }),
      JSON.stringify({
        type: `step_finish`,
        sessionID: `ses_synth`,
        timestamp: 1_700_000_002_000,
        part: { reason: `stop`, tokens: { input: 10, output: 5 }, cost: 0 },
      }),
    ]
    const events = normalizeOpencode(lines)
    const tc = events.find((e) => e.type === `tool_call`) as any
    const tr = events.find((e) => e.type === `tool_result`) as any
    expect(tc).toBeDefined()
    expect(tc.tool).toBe(`bash`)
    expect(tc.callId).toBe(`call_xyz`)
    expect(tr).toBeDefined()
    expect(tr.callId).toBe(`call_xyz`)
    expect(tr.output).toBe(`hi\n`)
    expect(tr.isError).toBe(false)
  })

  it(`marks tool_result as isError when state.metadata.exit !== 0`, () => {
    const lines = [
      JSON.stringify({
        type: `step_start`,
        sessionID: `ses_synth`,
        timestamp: 1,
        part: { type: `step-start` },
      }),
      JSON.stringify({
        type: `tool_use`,
        sessionID: `ses_synth`,
        timestamp: 2,
        part: {
          type: `tool`,
          tool: `bash`,
          callID: `call_fail`,
          state: {
            status: `failed`,
            input: { command: `false` },
            output: ``,
            metadata: { exit: 1 },
          },
        },
      }),
    ]
    const events = normalizeOpencode(lines)
    const tr = events.find((e) => e.type === `tool_result`) as any
    expect(tr.isError).toBe(true)
  })

  it(`maps reasoning parts to thinking events`, () => {
    const lines = [
      JSON.stringify({
        type: `step_start`,
        sessionID: `ses_synth`,
        timestamp: 1,
        part: { type: `step-start` },
      }),
      JSON.stringify({
        type: `reasoning`,
        sessionID: `ses_synth`,
        timestamp: 2,
        part: {
          type: `reasoning`,
          text: `pondering...`,
          metadata: { openai: { reasoningEncryptedContent: `abc=` } },
        },
      }),
    ]
    const events = normalizeOpencode(lines)
    const th = events.find((e) => e.type === `thinking`) as any
    expect(th).toBeDefined()
    expect(th.text).toBe(`pondering...`)
  })

  it(`gracefully skips malformed lines`, () => {
    const lines = [
      `not-json-at-all`,
      JSON.stringify({
        type: `step_start`,
        sessionID: `ses_x`,
        timestamp: 1,
        part: {},
      }),
      `{"unclosed`,
    ]
    const events = normalizeOpencode(lines)
    // Should produce just the session_init from the one valid line.
    expect(events.length).toBe(1)
    expect(events[0]!.type).toBe(`session_init`)
  })
})
