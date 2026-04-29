import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { Type } from '@sinclair/typebox'
import { runtimeLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'

export function createWriteTool(
  workingDirectory: string,
  readSet?: Set<string>
): AgentTool {
  return {
    name: `write`,
    label: `Write File`,
    description: `Create or overwrite a file. Path must be within the working directory. Parent directories are created as needed.`,
    parameters: Type.Object({
      path: Type.String({
        description: `File path (relative to working directory)`,
      }),
      content: Type.String({
        description: `Full file contents to write`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { path: filePath, content } = params as {
        path: string
        content: string
      }
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
            details: { bytesWritten: 0 },
          }
        }

        await mkdir(dirname(resolved), { recursive: true })
        await writeFile(resolved, content, `utf-8`)
        readSet?.add(resolved)

        const bytesWritten = Buffer.byteLength(content, `utf-8`)
        return {
          content: [
            {
              type: `text` as const,
              text: `Wrote ${bytesWritten} bytes to ${rel}`,
            },
          ],
          details: { bytesWritten },
        }
      } catch (err) {
        runtimeLog.warn(
          `[write tool]`,
          `failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}`
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error writing file: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { bytesWritten: 0 },
        }
      }
    },
  }
}
