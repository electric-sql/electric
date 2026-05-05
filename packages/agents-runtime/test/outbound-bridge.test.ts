import { describe, expect, it } from 'vitest'
import { createOutboundBridge } from '../src/outbound-bridge'
import { ev } from './helpers/event-fixtures'
import type { ChangeEvent } from '@durable-streams/state'

describe(`createOutboundBridge`, () => {
  it(`maps text_start to text insert event`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onTextStart()
    expect(writes).toHaveLength(2)
    expect(writes[1]!.type).toBe(`text`)
    expect(writes[1]!.key).toBe(`msg-0`)
    expect(writes[1]!.headers.operation).toBe(`insert`)
    expect((writes[1]!.value as Record<string, unknown>).status).toBe(
      `streaming`
    )
    expect((writes[1]!.value as Record<string, unknown>).run_id).toBe(`run-0`)
  })

  it(`maps text_delta to text_delta insert event with sequence`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onTextStart()
    bridge.onTextDelta(`Hello `)
    bridge.onTextDelta(`world`)

    expect(writes).toHaveLength(4)
    expect(writes[2]!.type).toBe(`text_delta`)
    expect(writes[2]!.key).toBe(`msg-0:0`)
    expect((writes[2]!.value as Record<string, unknown>).delta).toBe(`Hello `)
    expect((writes[2]!.value as Record<string, unknown>).run_id).toBe(`run-0`)
    expect(writes[3]!.key).toBe(`msg-0:1`)
    expect((writes[3]!.value as Record<string, unknown>).delta).toBe(`world`)
  })

  it(`maps text_end to text update event`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onTextStart()
    bridge.onTextDelta(`Hi`)
    bridge.onTextEnd()

    const last = writes[writes.length - 1]!
    expect(last.type).toBe(`text`)
    expect(last.key).toBe(`msg-0`)
    expect(last.headers.operation).toBe(`update`)
    expect((last.value as Record<string, unknown>).status).toBe(`completed`)
    expect((last.value as Record<string, unknown>).run_id).toBe(`run-0`)
  })

  it(`rejects text output outside an active run`, () => {
    const bridge = createOutboundBridge([], () => {})

    expect(() => bridge.onTextStart()).toThrow(/active run/i)
  })

  it(`rejects tool call outside an active run`, () => {
    const bridge = createOutboundBridge([], () => {})
    expect(() => bridge.onToolCallStart(`call-search`, `search`, {})).toThrow(
      /active run/i
    )
  })

  it(`rejects step start outside an active run`, () => {
    const bridge = createOutboundBridge([], () => {})
    expect(() => bridge.onStepStart()).toThrow(/active run/i)
  })

  it(`maps tool_call_start to tool_call insert`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onToolCallStart(`call-search`, `search`, { q: `test` })

    expect(writes).toHaveLength(2)
    expect(writes[1]!.type).toBe(`tool_call`)
    expect(writes[1]!.key).toBe(`tc-0`)
    expect((writes[1]!.value as Record<string, unknown>).tool_call_id).toBe(
      `call-search`
    )
    expect((writes[1]!.value as Record<string, unknown>).tool_name).toBe(
      `search`
    )
    expect((writes[1]!.value as Record<string, unknown>).status).toBe(`started`)
    expect((writes[1]!.value as Record<string, unknown>).run_id).toBe(`run-0`)
  })

  it(`maps tool_call_end to tool_call update with result`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onToolCallStart(`call-search`, `search`, { q: `test` })
    bridge.onToolCallEnd(`call-search`, `search`, `3 results`, false)

    expect(writes).toHaveLength(3)
    expect(writes[2]!.type).toBe(`tool_call`)
    expect(writes[2]!.key).toBe(`tc-0`)
    expect(writes[2]!.headers.operation).toBe(`update`)
    expect((writes[2]!.value as Record<string, unknown>).tool_call_id).toBe(
      `call-search`
    )
    expect((writes[2]!.value as Record<string, unknown>).status).toBe(
      `completed`
    )
    expect((writes[2]!.value as Record<string, unknown>).result).toBe(
      `3 results`
    )
    expect((writes[2]!.value as Record<string, unknown>).run_id).toBe(`run-0`)
  })

  it(`maps failed tool call with isError`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onToolCallStart(`call-bash`, `bash`, { cmd: `rm -rf /` })
    bridge.onToolCallEnd(`call-bash`, `bash`, `Permission denied`, true)

    expect((writes[2]!.value as Record<string, unknown>).status).toBe(`failed`)
    expect((writes[2]!.value as Record<string, unknown>).run_id).toBe(`run-0`)
  })

  it(`matches overlapping tool call starts and ends by provider id`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onToolCallStart(`call-a`, `search`, { q: `a` })
    bridge.onToolCallStart(`call-b`, `search`, { q: `b` })
    bridge.onToolCallEnd(`call-a`, `search`, `result a`, false)
    bridge.onToolCallEnd(`call-b`, `search`, `result b`, false)

    expect(writes[3]!.key).toBe(`tc-0`)
    expect((writes[3]!.value as Record<string, unknown>).tool_call_id).toBe(
      `call-a`
    )
    expect((writes[3]!.value as Record<string, unknown>).args).toEqual({
      q: `a`,
    })
    expect((writes[3]!.value as Record<string, unknown>).result).toBe(
      `result a`
    )
    expect(writes[4]!.key).toBe(`tc-1`)
    expect((writes[4]!.value as Record<string, unknown>).tool_call_id).toBe(
      `call-b`
    )
    expect((writes[4]!.value as Record<string, unknown>).args).toEqual({
      q: `b`,
    })
    expect((writes[4]!.value as Record<string, unknown>).result).toBe(
      `result b`
    )
  })

  it(`reconstructs ID counters from existing stream events`, () => {
    const existing: Array<ChangeEvent> = [
      ev(`run`, `run-2`, `insert`, { status: `started` }),
      ev(`text`, `msg-3`, `insert`, { status: `streaming` }),
      ev(`tool_call`, `tc-5`, `insert`, {
        tool_name: `existing`,
        status: `started`,
      }),
    ]
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge(existing, (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onTextStart()
    expect(writes[0]!.key).toBe(`run-3`)
    expect(writes[1]!.key).toBe(`msg-4`)

    bridge.onToolCallStart(`call-test`, `test`, {})
    expect(writes[2]!.key).toBe(`tc-6`)
    expect((writes[2]!.value as Record<string, unknown>).run_id).toBe(`run-3`)
  })

  it(`uses a preloaded ID seed for later reruns`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge(
      { run: 2, step: 4, msg: 3, tc: 5 },
      (event) => {
        writes.push(event)
      }
    )

    bridge.onRunStart()
    bridge.onStepStart()
    bridge.onTextStart()
    bridge.onToolCallStart(`call-search`, `search`, {})

    expect(writes[0]!.key).toBe(`run-2`)
    expect(writes[1]!.key).toBe(`step-4`)
    expect(writes[2]!.key).toBe(`msg-3`)
    expect(writes[3]!.key).toBe(`tc-5`)
  })

  it(`run lifecycle wraps text and tool calls`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    expect(writes[0]!.type).toBe(`run`)
    expect((writes[0]!.value as Record<string, unknown>).status).toBe(`started`)

    bridge.onTextStart()
    expect((writes[1]!.value as Record<string, unknown>).run_id).toBe(`run-0`)
    bridge.onTextDelta(`Hi`)
    bridge.onTextEnd()
    bridge.onRunEnd()

    const last = writes[writes.length - 1]!
    expect(last.type).toBe(`run`)
    expect(last.headers.operation).toBe(`update`)
    expect((last.value as Record<string, unknown>).status).toBe(`completed`)
  })

  it(`marks a run as failed when the finish reason is error`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onRunEnd({ finishReason: `error` })

    const last = writes[writes.length - 1]!
    expect(last.type).toBe(`run`)
    expect(last.headers.operation).toBe(`update`)
    expect((last.value as Record<string, unknown>).status).toBe(`failed`)
    expect((last.value as Record<string, unknown>).finish_reason).toBe(`error`)
  })

  it(`rejects text output after run ends`, () => {
    const bridge = createOutboundBridge([], () => {})

    bridge.onRunStart()
    bridge.onRunEnd()
    expect(() => bridge.onTextStart()).toThrow(/active run/i)
  })

  it(`rejects tool call after run ends`, () => {
    const bridge = createOutboundBridge([], () => {})

    bridge.onRunStart()
    bridge.onRunEnd()
    expect(() => bridge.onToolCallStart(`call-search`, `search`, {})).toThrow(
      /active run/i
    )
  })

  it(`rejects step start after run ends`, () => {
    const bridge = createOutboundBridge([], () => {})

    bridge.onRunStart()
    bridge.onRunEnd()
    expect(() => bridge.onStepStart()).toThrow(/active run/i)
  })

  it(`step events include run_id`, () => {
    const writes: Array<ChangeEvent> = []
    const bridge = createOutboundBridge([], (e) => {
      writes.push(e)
    })

    bridge.onRunStart()
    bridge.onStepStart({ modelId: `gpt-4` })
    bridge.onStepEnd({ finishReason: `stop` })

    // writes[0] = run insert, writes[1] = step insert, writes[2] = step update
    expect((writes[1]!.value as Record<string, unknown>).run_id).toBe(`run-0`)
    expect((writes[2]!.value as Record<string, unknown>).run_id).toBe(`run-0`)
  })
})
