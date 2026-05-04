import { Codex } from '@openai/codex-sdk'
import type {
  AgentMessageItem,
  CommandExecutionItem,
  ErrorItem,
  FileChangeItem,
  McpToolCallItem,
  ReasoningItem,
  ThreadItem,
  WebSearchItem,
} from '@openai/codex-sdk'
import { normalizeToolName } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'

import type { CodingSessionCliRunner } from '../coding-session.js'
import { subprocessEnvWithoutKey } from './env.js'

/**
 * SDK-backed runner for Codex. Codex's SDK exposes ThreadEvents that
 * wrap higher-level UI items (CommandExecutionItem, FileChangeItem,
 * etc.) — these are NOT the same shape as the lower-level
 * `response_item` payloads that land in the rollout JSONL, so we can't
 * route them through `normalizeCodexEvent`. Instead this runner
 * synthesises `NormalizedEvent`s directly from each completed
 * ThreadItem.
 *
 * Each tool-style item is emitted as a tool_call when it starts and a
 * matching tool_result when it completes, so the UI shows the same
 * lifecycle it would for a CLI-driven session.
 */
export const codexSdkRunner: CodingSessionCliRunner = {
  async run(opts) {
    // Hide OPENAI_API_KEY from the spawned `codex` subprocess so it
    // falls back to user-configured credentials (`codex login` writes
    // tokens to `~/.codex/auth.json`). Symmetric with the Claude
    // runner — neither coder runner consumes the parent process's API
    // keys so a Horton+coder co-tenant can keep the keys in scope for
    // direct API calls without leaking them into the CLI subprocesses.
    const codex = new Codex({ env: subprocessEnvWithoutKey(`OPENAI_API_KEY`) })
    // Mirror what the CLI runner did: write access in the cwd and no
    // interactive approval prompts. Without these the SDK defaults to
    // `read-only` + `on-request` and the agent fails the moment it
    // tries to edit a file.
    const threadOptions = {
      workingDirectory: opts.cwd,
      skipGitRepoCheck: true,
      sandboxMode: `workspace-write` as const,
      approvalPolicy: `never` as const,
    }
    const thread = opts.sessionId
      ? codex.resumeThread(opts.sessionId, threadOptions)
      : codex.startThread(threadOptions)

    let turnFailed: { message: string } | null = null
    let assistantText = ``
    let capturedSessionId: string | null = opts.sessionId ?? null

    try {
      const { events } = await thread.runStreamed(opts.prompt)
      for await (const ev of events) {
        if (!capturedSessionId && thread.id) {
          capturedSessionId = thread.id
          opts.onSessionId?.(thread.id)
        }

        switch (ev.type) {
          case `thread.started`: {
            if (!capturedSessionId) {
              capturedSessionId = ev.thread_id
              opts.onSessionId?.(ev.thread_id)
            }
            opts.onEvent?.({
              v: 1,
              ts: Date.now(),
              type: `session_init`,
              sessionId: ev.thread_id,
              cwd: opts.cwd,
              agent: `codex`,
            })
            break
          }
          case `item.started`: {
            const startEvents = threadItemStartedToEvents(ev.item)
            for (const e of startEvents) opts.onEvent?.(e)
            break
          }
          case `item.completed`: {
            const completeEvents = threadItemCompletedToEvents(ev.item)
            for (const e of completeEvents) opts.onEvent?.(e)
            if (ev.item.type === `agent_message`) {
              assistantText += (assistantText ? `\n` : ``) + ev.item.text
            }
            break
          }
          case `turn.completed`: {
            opts.onEvent?.({
              v: 1,
              ts: Date.now(),
              type: `turn_complete`,
              success: true,
              usage: {
                inputTokens: ev.usage.input_tokens,
                outputTokens: ev.usage.output_tokens,
                cachedInputTokens: ev.usage.cached_input_tokens,
                reasoningOutputTokens: ev.usage.reasoning_output_tokens,
              },
            })
            break
          }
          case `turn.failed`: {
            turnFailed = { message: ev.error.message }
            opts.onEvent?.({
              v: 1,
              ts: Date.now(),
              type: `turn_aborted`,
              reason: ev.error.message,
            })
            break
          }
          case `error`: {
            turnFailed = { message: ev.message }
            opts.onEvent?.({
              v: 1,
              ts: Date.now(),
              type: `error`,
              message: ev.message,
            })
            break
          }
          case `item.updated`:
          case `turn.started`:
            break
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return { exitCode: -1, stdout: ``, stderr: message }
    }

    if (turnFailed) {
      return { exitCode: 1, stdout: assistantText, stderr: turnFailed.message }
    }
    return { exitCode: 0, stdout: assistantText, stderr: `` }
  },
}

/** Exported for unit testing — the runner is the only production caller. */
export function threadItemStartedToEvents(
  item: ThreadItem
): Array<NormalizedEvent> {
  const ts = Date.now()
  switch (item.type) {
    case `command_execution`:
      return [commandExecutionToToolCall(item, ts)]
    case `mcp_tool_call`:
      return [mcpToolCallToToolCall(item, ts)]
    case `web_search`:
      return [webSearchToToolCall(item, ts)]
    case `file_change`:
    case `agent_message`:
    case `reasoning`:
    case `todo_list`:
    case `error`:
      return []
  }
}

/** Exported for unit testing — the runner is the only production caller. */
export function threadItemCompletedToEvents(
  item: ThreadItem
): Array<NormalizedEvent> {
  const ts = Date.now()
  switch (item.type) {
    case `agent_message`:
      return [agentMessageToEvent(item, ts)]
    case `reasoning`:
      return [reasoningToEvent(item, ts)]
    case `command_execution`:
      return [commandExecutionToToolResult(item, ts)]
    case `file_change`:
      return fileChangeToEvents(item, ts)
    case `mcp_tool_call`:
      return [mcpToolCallToToolResult(item, ts)]
    case `web_search`:
      // Codex's WebSearchItem doesn't expose the search results to the
      // SDK consumer (only `query`), so we can't produce a meaningful
      // tool_result payload. Emit an empty one anyway to honor the
      // tool_call→tool_result contract — without it any UI rendering
      // tool lifecycles would show a perpetually-pending web search.
      return [webSearchToToolResult(item, ts)]
    case `todo_list`:
      return []
    case `error`:
      return [errorItemToEvent(item, ts)]
  }
}

function agentMessageToEvent(
  item: AgentMessageItem,
  ts: number
): NormalizedEvent {
  return {
    v: 1,
    ts,
    type: `assistant_message`,
    text: item.text,
    phase: `final`,
  }
}

function reasoningToEvent(item: ReasoningItem, ts: number): NormalizedEvent {
  return {
    v: 1,
    ts,
    type: `thinking`,
    summary: item.text.slice(0, 200) || `(thinking)`,
    text: item.text || null,
  }
}

function commandExecutionToToolCall(
  item: CommandExecutionItem,
  ts: number
): NormalizedEvent {
  const mapping = normalizeToolName(`exec_command`, `codex`, {
    command: item.command,
  })
  return {
    v: 1,
    ts,
    type: `tool_call`,
    callId: item.id,
    tool: mapping.normalized,
    originalTool: mapping.originalTool,
    originalAgent: `codex`,
    input: { command: item.command },
  }
}

function commandExecutionToToolResult(
  item: CommandExecutionItem,
  ts: number
): NormalizedEvent {
  const isError = item.status === `failed` || (item.exit_code ?? 0) !== 0
  return {
    v: 1,
    ts,
    type: `tool_result`,
    callId: item.id,
    output: item.aggregated_output,
    isError,
    ...(item.exit_code !== undefined ? { exitCode: item.exit_code } : {}),
  }
}

function fileChangeToEvents(
  item: FileChangeItem,
  ts: number
): Array<NormalizedEvent> {
  const isError = item.status === `failed`
  // Synthesise a tool_call + tool_result pair for the patch as a whole.
  // Codex doesn't expose per-file ids, so we use the FileChangeItem's id
  // for both events.
  const summary = item.changes.map((c) => `${c.kind} ${c.path}`).join(`\n`)
  const allAdds = item.changes.every((c) => c.kind === `add`)
  const tool = allAdds ? `file_write` : `file_edit`
  return [
    {
      v: 1,
      ts,
      type: `tool_call`,
      callId: item.id,
      tool,
      originalTool: `apply_patch`,
      originalAgent: `codex`,
      input: { changes: item.changes },
    },
    {
      v: 1,
      ts,
      type: `tool_result`,
      callId: item.id,
      output: summary,
      isError,
    },
  ]
}

function mcpToolCallToToolCall(
  item: McpToolCallItem,
  ts: number
): NormalizedEvent {
  return {
    v: 1,
    ts,
    type: `tool_call`,
    callId: item.id,
    tool: item.tool,
    originalTool: item.tool,
    originalAgent: `codex`,
    input: (item.arguments as Record<string, unknown>) ?? {},
  }
}

function mcpToolCallToToolResult(
  item: McpToolCallItem,
  ts: number
): NormalizedEvent {
  const isError = item.status === `failed`
  const output = item.error
    ? item.error.message
    : item.result
      ? JSON.stringify(item.result.structured_content ?? item.result.content)
      : ``
  return {
    v: 1,
    ts,
    type: `tool_result`,
    callId: item.id,
    output,
    isError,
  }
}

function webSearchToToolCall(item: WebSearchItem, ts: number): NormalizedEvent {
  return {
    v: 1,
    ts,
    type: `tool_call`,
    callId: item.id,
    tool: `web_search`,
    originalTool: `web_search`,
    originalAgent: `codex`,
    input: { query: item.query },
  }
}

function webSearchToToolResult(
  item: WebSearchItem,
  ts: number
): NormalizedEvent {
  return {
    v: 1,
    ts,
    type: `tool_result`,
    callId: item.id,
    output: ``,
    isError: false,
  }
}

function errorItemToEvent(item: ErrorItem, ts: number): NormalizedEvent {
  return {
    v: 1,
    ts,
    type: `error`,
    message: item.message,
  }
}
