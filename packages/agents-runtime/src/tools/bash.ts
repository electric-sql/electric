import { exec } from 'node:child_process'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'

const TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 50_000

export function createBashTool(workingDirectory: string): AgentTool {
  return {
    name: `bash`,
    label: `Bash`,
    description: `Execute a shell command and return its output. Commands run in a sandboxed working directory with a 30-second timeout.`,
    parameters: Type.Object({
      command: Type.String({ description: `The shell command to execute` }),
    }),
    execute: async (_toolCallId, params) => {
      const { command } = params as { command: string }
      return new Promise((resolve) => {
        const child = exec(command, {
          cwd: workingDirectory,
          timeout: TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          env: { ...process.env },
        })

        let stdout = ``
        let stderr = ``

        child.stdout?.on(`data`, (data: string) => {
          stdout += data
        })
        child.stderr?.on(`data`, (data: string) => {
          stderr += data
        })

        child.on(`close`, (code, signal) => {
          const timedOut = signal === `SIGTERM`
          let output = stdout
          if (stderr) {
            output += output ? `\n\nSTDERR:\n${stderr}` : stderr
          }
          if (timedOut) {
            output += `\n\n[Command timed out after ${TIMEOUT_MS / 1000}s]`
          }

          output = output.slice(0, MAX_OUTPUT_CHARS)

          resolve({
            content: [{ type: `text` as const, text: output || `(no output)` }],
            details: { exitCode: code ?? 1, timedOut },
          })
        })

        child.on(`error`, (err) => {
          resolve({
            content: [
              {
                type: `text` as const,
                text: `Command failed: ${err.message}`,
              },
            ],
            details: { exitCode: 1, timedOut: false },
          })
        })
      })
    },
  }
}
