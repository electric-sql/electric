import { Type } from '@sinclair/typebox'
import type { Sandbox } from '../sandbox/types'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_BYTES = 50_000

function normalizeTimeoutMs(value: unknown): number {
  if (typeof value !== `number` || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_TIMEOUT_MS)
}

export function createBashTool(sandbox: Sandbox): AgentTool {
  return {
    name: `bash`,
    label: `Bash`,
    description: `Execute a shell command and return its output. Commands run with a 2-minute timeout by default; pass timeoutMs to request up to 10 minutes. Commands have a 50KB output cap. The host process environment is not forwarded, so host secrets (e.g. API keys) are not available as environment variables.`,
    parameters: Type.Object({
      command: Type.String({ description: `The shell command to execute` }),
      timeoutMs: Type.Optional(
        Type.Number({
          description: `Optional timeout in milliseconds. Defaults to 120000 (2 minutes), maximum 600000 (10 minutes). Values above the maximum are clamped.`,
          minimum: 1,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { command, timeoutMs: requestedTimeoutMs } = params as {
        command: string
        timeoutMs?: number
      }
      const timeoutMs = normalizeTimeoutMs(requestedTimeoutMs)
      const result = await sandbox.exec({
        command,
        timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })

      let output = result.stdout.toString(`utf-8`)
      const stderr = result.stderr.toString(`utf-8`)
      if (stderr) {
        output += output ? `\n\nSTDERR:\n${stderr}` : stderr
      }
      if (result.timedOut) {
        output += `\n\n[Command timed out after ${timeoutMs / 1000}s]`
      }
      if (result.outputTruncated) {
        output += `\n\n[Output truncated at ${MAX_OUTPUT_BYTES} bytes]`
      }

      return {
        content: [{ type: `text` as const, text: output || `(no output)` }],
        details: {
          exitCode: result.exitCode ?? 1,
          timedOut: result.timedOut,
        },
      }
    },
  }
}
