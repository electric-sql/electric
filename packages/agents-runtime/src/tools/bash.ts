import { Type } from '@sinclair/typebox'
import type { Sandbox } from '../sandbox/types'
import type { AgentTool } from '@mariozechner/pi-agent-core'

const TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 50_000

export function createBashTool(sandbox: Sandbox): AgentTool {
  return {
    name: `bash`,
    label: `Bash`,
    description: `Execute a shell command and return its output. Commands run with a 30-second timeout and a 50KB output cap.`,
    parameters: Type.Object({
      command: Type.String({ description: `The shell command to execute` }),
    }),
    execute: async (_toolCallId, params) => {
      const { command } = params as { command: string }
      const result = await sandbox.exec({
        command,
        timeoutMs: TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      })

      let output = result.stdout.toString(`utf-8`)
      const stderr = result.stderr.toString(`utf-8`)
      if (stderr) {
        output += output ? `\n\nSTDERR:\n${stderr}` : stderr
      }
      if (result.timedOut) {
        output += `\n\n[Command timed out after ${TIMEOUT_MS / 1000}s]`
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
