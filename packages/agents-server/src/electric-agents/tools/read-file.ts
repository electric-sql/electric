import { readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { Type } from '@sinclair/typebox'
import { serverLog } from '../../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'

const MAX_FILE_SIZE = 512 * 1024 // 512 KB

export function createReadFileTool(
  workingDirectory: string,
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
        const resolved = resolve(workingDirectory, filePath)
        const rel = relative(workingDirectory, resolved)
        if (rel.startsWith(`..`)) {
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

        const fileStat = await stat(resolved)
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

        const buffer = await readFile(resolved)

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
        readSet?.add(resolved)
        return {
          content: [{ type: `text` as const, text }],
          details: { charCount: text.length },
        }
      } catch (err) {
        serverLog.warn(
          `[read tool] failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
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
