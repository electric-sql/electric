import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { normalizeClaudeEvent } from 'agent-session-protocol'
import type { ClaudeEntry } from 'agent-session-protocol'

import type { CodingSessionCliRunner } from '../coding-session.js'

/**
 * SDK-backed runner for Claude. Drives `query()` from
 * `@anthropic-ai/claude-agent-sdk`, iterates the resulting async
 * generator, adapts each `SDKMessage` to the `ClaudeEntry` shape
 * `normalizeClaudeEvent` expects, and forwards each emitted normalized
 * event via the `onEvent` callback.
 *
 * The Claude SDK ships its own subprocess binary as an optional
 * platform-specific dep, so this no longer requires a globally
 * installed `claude` CLI on PATH.
 */
export const claudeSdkRunner: CodingSessionCliRunner = {
  async run(opts) {
    const q = query({
      prompt: opts.prompt,
      options: {
        cwd: opts.cwd,
        ...(opts.sessionId ? { resume: opts.sessionId } : {}),
        permissionMode: `bypassPermissions`,
        allowDangerouslySkipPermissions: true,
      },
    })

    let capturedSessionId: string | null = opts.sessionId ?? null
    let resultMessage: {
      is_error: boolean
      result?: string
      error?: string
    } | null = null

    try {
      for await (const msg of q) {
        const sid = (msg as { session_id?: string }).session_id
        if (sid && sid !== capturedSessionId) {
          capturedSessionId = sid
          opts.onSessionId?.(sid)
        }

        if (msg.type === `result`) {
          resultMessage = {
            is_error: msg.is_error,
            result: `result` in msg ? msg.result : undefined,
            error:
              `subtype` in msg && msg.subtype !== `success`
                ? msg.subtype
                : undefined,
          }
        }

        const entry = sdkMessageToClaudeEntry(msg)
        if (!entry) continue
        for (const ev of normalizeClaudeEvent(entry)) opts.onEvent?.(ev)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { exitCode: -1, stdout: ``, stderr: message }
    }

    if (resultMessage?.is_error) {
      return {
        exitCode: 1,
        stdout: resultMessage.result ?? ``,
        stderr: resultMessage.error ?? `claude SDK reported is_error`,
      }
    }
    return { exitCode: 0, stdout: resultMessage?.result ?? ``, stderr: `` }
  },
}

/**
 * Adapt one `SDKMessage` to the `ClaudeEntry` shape the JSONL
 * normaliser expects. The SDK and the JSONL share *most* fields but
 * differ in casing on a few keys (`session_id` vs `sessionId`,
 * `claude_code_version` vs `version`, `duration_ms` vs `durationMs`).
 * Everything else is structurally compatible.
 *
 * Returns null for SDK-only message types (status pings, retries, hook
 * lifecycle, etc.) that have no JSONL counterpart.
 */
function sdkMessageToClaudeEntry(msg: SDKMessage): ClaudeEntry | null {
  const ts =
    (msg as { timestamp?: string }).timestamp ?? new Date().toISOString()
  const sessionId = (msg as { session_id?: string }).session_id

  if (msg.type === `system`) {
    if (`subtype` in msg && msg.subtype === `init`) {
      return {
        type: `system`,
        subtype: `init`,
        timestamp: ts,
        sessionId,
        cwd: msg.cwd,
        version: msg.claude_code_version,
        message: { model: msg.model },
      }
    }
    if (`subtype` in msg && msg.subtype === `compact_boundary`) {
      return {
        type: `system`,
        subtype: `compact_boundary`,
        timestamp: ts,
        sessionId,
      }
    }
    return null
  }

  if (msg.type === `user`) {
    const inner = msg.message as
      | { role?: string; content?: unknown }
      | undefined
    return {
      type: `user`,
      timestamp: ts,
      sessionId,
      message: {
        role: `user`,
        content: inner?.content,
      },
    }
  }

  if (msg.type === `assistant`) {
    const inner = msg.message as {
      role?: string
      model?: string
      content?: unknown
      stop_reason?: string
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
      }
    }
    return {
      type: `assistant`,
      timestamp: ts,
      sessionId,
      message: {
        role: `assistant`,
        model: inner.model,
        content: inner.content,
        stop_reason: inner.stop_reason,
        usage: inner.usage,
      },
    }
  }

  if (msg.type === `result`) {
    return {
      type: `result`,
      timestamp: ts,
      sessionId,
      subtype: msg.subtype,
      durationMs: msg.duration_ms,
      message: msg.usage
        ? {
            usage: {
              input_tokens: msg.usage.input_tokens,
              output_tokens: msg.usage.output_tokens,
              cache_read_input_tokens: msg.usage.cache_read_input_tokens,
              cache_creation_input_tokens:
                msg.usage.cache_creation_input_tokens,
            },
          }
        : undefined,
    }
  }

  return null
}
