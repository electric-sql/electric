import { resolve } from 'node:path'
import { Type } from '@sinclair/typebox'
import { runtimeLog } from '../log'
import { SandboxError } from '../sandbox/types'
import type { Sandbox } from '../sandbox/types'
import type { AgentTool } from '@mariozechner/pi-agent-core'

const MAX_FILE_SIZE = 512 * 1024 // 512 KB

export function createReadFileTool(
  sandbox: Sandbox,
  readSet?: Set<string>
): AgentTool {
  return {
    name: `read`,
    label: `Read File`,
    description: `Read the contents of a file. Path must be relative to or within the working directory. Binary files and files over 512KB are rejected.`,
    parameters: Type.Object({
      path: Type.String({
        description: `File path (relative to working directory)`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { path: filePath } = params as { path: string }
      try {
        // Path resolution and workspace containment are the sandbox's job
        // (it owns the filesystem); a denied path rejects with
        // SandboxError('policy'), handled below. We only stat for the size
        // gate, which is a tool-level concern.
        const fileStat = await sandbox.stat(filePath)
        if (fileStat.size > MAX_FILE_SIZE) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error: File is too large (${(fileStat.size / 1024).toFixed(0)}KB > ${MAX_FILE_SIZE / 1024}KB limit)`,
              },
            ],
            details: { charCount: 0 },
          }
        }

        const buffer = await sandbox.readFile(filePath)

        // Detect binary: check for null bytes in the first 8KB (same heuristic git/grep use).
        const sample = buffer.subarray(0, 8192)
        if (sample.includes(0)) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error: "${filePath}" appears to be a binary file`,
              },
            ],
            details: { charCount: 0 },
          }
        }

        const text = buffer.toString(`utf-8`)
        readSet?.add(resolve(sandbox.workingDirectory, filePath))
        return {
          content: [{ type: `text` as const, text }],
          details: { charCount: text.length },
        }
      } catch (err) {
        if (err instanceof SandboxError && err.kind === `policy`) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error: Path "${filePath}" is outside the working directory`,
              },
            ],
            details: { charCount: 0 },
          }
        }
        runtimeLog.warn(
          `[read tool]`,
          `failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error reading file: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { charCount: 0 },
        }
      }
    },
  }
}
