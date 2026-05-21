import { dirname, relative } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { Type } from '@sinclair/typebox'
import { runtimeLog } from '../log'
import { resolveSafePath } from './safe-path'
import type { Sandbox } from '../sandbox/types'
import type { AgentTool } from '@mariozechner/pi-agent-core'

export function createWriteTool(
  sandbox: Sandbox,
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
        const resolved = await resolveSafePath(
          sandbox.workingDirectory,
          filePath
        )
        if (!resolved) {
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
        const rel = relative(sandbox.workingDirectory, resolved)

        let original = ``
        const existed = await sandbox.exists(resolved)
        if (existed) {
          const buf = await sandbox.readFile(resolved)
          original = buf.toString(`utf-8`)
        }

        await sandbox.mkdir(dirname(resolved), { recursive: true })
        await sandbox.writeFile(resolved, content)
        readSet?.add(resolved)

        const bytesWritten = Buffer.byteLength(content, `utf-8`)
        const patch = createTwoFilesPatch(
          existed ? rel : `/dev/null`,
          rel,
          original,
          content,
          undefined,
          undefined,
          { context: 3 }
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Wrote ${bytesWritten} bytes to ${rel}`,
            },
          ],
          details: { bytesWritten, diff: patch, existed },
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
