import { dirname, relative, resolve } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { Type } from '@sinclair/typebox'
import { runtimeLog } from '../log'
import { SandboxError } from '../sandbox/types'
import type { Sandbox } from '../sandbox/types'
import type { AgentTool } from '@mariozechner/pi-agent-core'

export function createWriteTool(sandbox: Sandbox): AgentTool {
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
      // Containment is enforced by the sandbox (it owns the filesystem);
      // an escaping path rejects with SandboxError('policy'), handled below.
      // `key`/`rel` are pure-string normalizations for the diff header — not a security check.
      const key = resolve(sandbox.workingDirectory, filePath)
      const rel = relative(sandbox.workingDirectory, key)
      try {
        let original = ``
        const existed = await sandbox.exists(filePath)
        if (existed) {
          const buf = await sandbox.readFile(filePath)
          original = buf.toString(`utf-8`)
        }

        await sandbox.mkdir(dirname(filePath), { recursive: true })
        await sandbox.writeFile(filePath, content)

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
        if (err instanceof SandboxError && err.kind === `policy`) {
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
