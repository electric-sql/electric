import { describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { sdkMessageToClaudeEntry } from '../../src/agents/runners/claude-sdk'

describe(`sdkMessageToClaudeEntry`, () => {
  it(`maps a system/init message to a ClaudeEntry init entry`, () => {
    const msg = {
      type: `system`,
      subtype: `init`,
      session_id: `s-1`,
      cwd: `/tmp/x`,
      claude_code_version: `2.1.83`,
      model: `claude-sonnet-4-5`,
      tools: [],
      mcp_servers: [],
      slash_commands: [],
      output_style: ``,
      skills: [],
      plugins: [],
      apiKeySource: `user`,
      permissionMode: `default`,
      uuid: `u-1`,
    } as unknown as SDKMessage
    const entry = sdkMessageToClaudeEntry(msg)
    expect(entry).toMatchObject({
      type: `system`,
      subtype: `init`,
      sessionId: `s-1`,
      cwd: `/tmp/x`,
      version: `2.1.83`,
      message: { model: `claude-sonnet-4-5` },
    })
  })

  it(`maps a system/compact_boundary message`, () => {
    const msg = {
      type: `system`,
      subtype: `compact_boundary`,
      session_id: `s-1`,
      compact_metadata: { trigger: `auto`, pre_tokens: 100 },
      uuid: `u-2`,
    } as unknown as SDKMessage
    const entry = sdkMessageToClaudeEntry(msg)
    expect(entry).toMatchObject({
      type: `system`,
      subtype: `compact_boundary`,
      sessionId: `s-1`,
    })
  })

  it(`maps a user message`, () => {
    const msg = {
      type: `user`,
      session_id: `s-1`,
      message: { role: `user`, content: `hello` },
      parent_tool_use_id: null,
    } as unknown as SDKMessage
    const entry = sdkMessageToClaudeEntry(msg)
    expect(entry).toMatchObject({
      type: `user`,
      sessionId: `s-1`,
      message: { role: `user`, content: `hello` },
    })
  })

  it(`maps an assistant message and preserves usage + stop_reason`, () => {
    const msg = {
      type: `assistant`,
      session_id: `s-1`,
      message: {
        id: `m-1`,
        type: `message`,
        role: `assistant`,
        model: `claude-sonnet-4-5`,
        content: [{ type: `text`, text: `hi` }],
        stop_reason: `end_turn`,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
      parent_tool_use_id: null,
      uuid: `u-3`,
    } as unknown as SDKMessage
    const entry = sdkMessageToClaudeEntry(msg)
    expect(entry).toMatchObject({
      type: `assistant`,
      sessionId: `s-1`,
      message: {
        role: `assistant`,
        model: `claude-sonnet-4-5`,
        stop_reason: `end_turn`,
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    })
    // content is forwarded through so normalizeClaudeEvent can iterate it
    expect((entry!.message!.content as Array<unknown>)[0]).toMatchObject({
      type: `text`,
      text: `hi`,
    })
  })

  it(`maps a result message and renames duration_ms to durationMs`, () => {
    const msg = {
      type: `result`,
      subtype: `success`,
      session_id: `s-1`,
      duration_ms: 1234,
      duration_api_ms: 1000,
      is_error: false,
      num_turns: 1,
      result: `done`,
      stop_reason: `end_turn`,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
      uuid: `u-4`,
    } as unknown as SDKMessage
    const entry = sdkMessageToClaudeEntry(msg)
    expect(entry).toMatchObject({
      type: `result`,
      subtype: `success`,
      sessionId: `s-1`,
      durationMs: 1234,
      message: {
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    })
  })

  it(`returns null for SDK-only message types`, () => {
    const msg = {
      type: `auth_status`,
      session_id: `s-1`,
      isAuthenticating: false,
      output: [],
      uuid: `u-5`,
    } as unknown as SDKMessage
    expect(sdkMessageToClaudeEntry(msg)).toBeNull()
  })
})
