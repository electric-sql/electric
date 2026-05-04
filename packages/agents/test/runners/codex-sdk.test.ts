import { describe, expect, it } from 'vitest'
import type { ThreadItem } from '@openai/codex-sdk'
import {
  threadItemCompletedToEvents,
  threadItemStartedToEvents,
} from '../../src/agents/runners/codex-sdk'

describe(`threadItemStartedToEvents`, () => {
  it(`maps command_execution to a tool_call (terminal for an unclassified cmd)`, () => {
    const item: ThreadItem = {
      id: `i-1`,
      type: `command_execution`,
      command: `pwd`,
      aggregated_output: ``,
      status: `in_progress`,
    }
    const events = threadItemStartedToEvents(item)
    expect(events).toHaveLength(1)
    const ev = events[0]!
    expect(ev).toMatchObject({
      type: `tool_call`,
      callId: `i-1`,
      tool: `terminal`,
      originalTool: `exec_command`,
      originalAgent: `codex`,
      input: { command: `pwd` },
    })
  })

  it(`classifies cat <file> as file_read`, () => {
    const item: ThreadItem = {
      id: `i-2`,
      type: `command_execution`,
      command: `cat /tmp/x.txt`,
      aggregated_output: ``,
      status: `in_progress`,
    }
    const ev = threadItemStartedToEvents(item)[0]!
    if (ev.type !== `tool_call`) throw new Error(`unexpected`)
    expect(ev.tool).toBe(`file_read`)
  })

  it(`maps mcp_tool_call to a tool_call carrying the MCP tool name`, () => {
    const item: ThreadItem = {
      id: `i-3`,
      type: `mcp_tool_call`,
      server: `my-server`,
      tool: `my_tool`,
      arguments: { foo: 1 },
      status: `in_progress`,
    }
    const ev = threadItemStartedToEvents(item)[0]!
    expect(ev).toMatchObject({
      type: `tool_call`,
      callId: `i-3`,
      tool: `my_tool`,
      originalTool: `my_tool`,
      input: { foo: 1 },
    })
  })

  it(`maps web_search to a tool_call`, () => {
    const item: ThreadItem = {
      id: `i-4`,
      type: `web_search`,
      query: `electric sql`,
    }
    const ev = threadItemStartedToEvents(item)[0]!
    expect(ev).toMatchObject({
      type: `tool_call`,
      callId: `i-4`,
      tool: `web_search`,
      input: { query: `electric sql` },
    })
  })

  it(`emits nothing on start for items completed in one event`, () => {
    const items: Array<ThreadItem> = [
      { id: `m-1`, type: `agent_message`, text: `hello` },
      { id: `r-1`, type: `reasoning`, text: `step 1` },
      {
        id: `f-1`,
        type: `file_change`,
        changes: [{ path: `a.txt`, kind: `add` }],
        status: `completed`,
      },
    ]
    for (const item of items) {
      expect(threadItemStartedToEvents(item)).toEqual([])
    }
  })
})

describe(`threadItemCompletedToEvents`, () => {
  it(`maps agent_message to assistant_message with phase=final`, () => {
    const item: ThreadItem = {
      id: `m-1`,
      type: `agent_message`,
      text: `done`,
    }
    expect(threadItemCompletedToEvents(item)[0]).toMatchObject({
      type: `assistant_message`,
      text: `done`,
      phase: `final`,
    })
  })

  it(`maps reasoning to thinking`, () => {
    const item: ThreadItem = {
      id: `r-1`,
      type: `reasoning`,
      text: `the user asked for X so I'll do Y`,
    }
    const ev = threadItemCompletedToEvents(item)[0]!
    expect(ev).toMatchObject({
      type: `thinking`,
      text: `the user asked for X so I'll do Y`,
    })
    if (ev.type === `thinking`) {
      expect(ev.summary.length).toBeLessThanOrEqual(200)
    }
  })

  it(`maps a successful command_execution to tool_result`, () => {
    const item: ThreadItem = {
      id: `i-1`,
      type: `command_execution`,
      command: `ls /`,
      aggregated_output: `bin\netc`,
      exit_code: 0,
      status: `completed`,
    }
    expect(threadItemCompletedToEvents(item)[0]).toMatchObject({
      type: `tool_result`,
      callId: `i-1`,
      output: `bin\netc`,
      isError: false,
      exitCode: 0,
    })
  })

  it(`marks a non-zero exit as error`, () => {
    const item: ThreadItem = {
      id: `i-2`,
      type: `command_execution`,
      command: `false`,
      aggregated_output: ``,
      exit_code: 1,
      status: `completed`,
    }
    const ev = threadItemCompletedToEvents(item)[0]!
    if (ev.type !== `tool_result`) throw new Error(`unexpected`)
    expect(ev.isError).toBe(true)
  })

  it(`emits paired tool_call+tool_result for file_change`, () => {
    const item: ThreadItem = {
      id: `f-1`,
      type: `file_change`,
      changes: [
        { path: `a.txt`, kind: `add` },
        { path: `b.txt`, kind: `update` },
      ],
      status: `completed`,
    }
    const events = threadItemCompletedToEvents(item)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: `tool_call`,
      callId: `f-1`,
      tool: `file_edit`, // mixed adds + updates → file_edit
      originalTool: `apply_patch`,
    })
    expect(events[1]).toMatchObject({
      type: `tool_result`,
      callId: `f-1`,
      isError: false,
    })
  })

  it(`maps an all-add file_change to file_write`, () => {
    const item: ThreadItem = {
      id: `f-2`,
      type: `file_change`,
      changes: [{ path: `new.txt`, kind: `add` }],
      status: `completed`,
    }
    const ev = threadItemCompletedToEvents(item)[0]!
    if (ev.type !== `tool_call`) throw new Error(`unexpected`)
    expect(ev.tool).toBe(`file_write`)
  })

  it(`maps mcp_tool_call success to tool_result with structured content`, () => {
    const item: ThreadItem = {
      id: `i-3`,
      type: `mcp_tool_call`,
      server: `s`,
      tool: `t`,
      arguments: {},
      result: {
        content: [],
        structured_content: { ok: true },
      },
      status: `completed`,
    }
    const ev = threadItemCompletedToEvents(item)[0]!
    expect(ev).toMatchObject({
      type: `tool_result`,
      callId: `i-3`,
      isError: false,
    })
    if (ev.type === `tool_result`) {
      expect(JSON.parse(ev.output)).toEqual({ ok: true })
    }
  })

  it(`maps mcp_tool_call failure to error tool_result`, () => {
    const item: ThreadItem = {
      id: `i-4`,
      type: `mcp_tool_call`,
      server: `s`,
      tool: `t`,
      arguments: {},
      error: { message: `boom` },
      status: `failed`,
    }
    const ev = threadItemCompletedToEvents(item)[0]!
    expect(ev).toMatchObject({
      type: `tool_result`,
      callId: `i-4`,
      output: `boom`,
      isError: true,
    })
  })

  it(`closes the web_search lifecycle with an empty tool_result`, () => {
    const item: ThreadItem = {
      id: `i-5`,
      type: `web_search`,
      query: `q`,
    }
    expect(threadItemCompletedToEvents(item)[0]).toMatchObject({
      type: `tool_result`,
      callId: `i-5`,
      output: ``,
      isError: false,
    })
  })

  it(`maps error items to an error event`, () => {
    const item: ThreadItem = {
      id: `e-1`,
      type: `error`,
      message: `something broke`,
    }
    expect(threadItemCompletedToEvents(item)[0]).toMatchObject({
      type: `error`,
      message: `something broke`,
    })
  })

  it(`returns empty for todo_list (no normalized counterpart yet)`, () => {
    const item: ThreadItem = {
      id: `t-1`,
      type: `todo_list`,
      items: [{ text: `do x`, completed: false }],
    }
    expect(threadItemCompletedToEvents(item)).toEqual([])
  })
})
