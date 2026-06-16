import { relative, resolve } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { Type } from '@sinclair/typebox'
import { runtimeLog } from '../log'
import { SandboxError } from '../sandbox/types'
import type { Sandbox } from '../sandbox/types'
import type { AgentTool } from '@mariozechner/pi-agent-core'

export function createEditTool(
  sandbox: Sandbox,
  _readSet?: Set<string>
): AgentTool {
  return {
    name: `edit`,
    label: `Edit File`,
    description: `Replace text in a file. By default the old_string must occur exactly once; set replace_all to true to replace every occurrence.`,
    parameters: Type.Object({
      path: Type.String({
        description: `File path (relative to working directory)`,
      }),
      old_string: Type.String({
        description: `The literal text to find. Must be unique unless replace_all is true.`,
      }),
      new_string: Type.String({
        description: `The replacement text.`,
      }),
      replace_all: Type.Optional(
        Type.Boolean({
          description: `Replace every occurrence (default false).`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const {
        path: filePath,
        old_string,
        new_string,
        replace_all,
      } = params as {
        path: string
        old_string: string
        new_string: string
        replace_all?: boolean
      }
      const key = resolve(sandbox.workingDirectory, filePath)
      const rel = relative(sandbox.workingDirectory, key)
      try {
        const original = (await sandbox.readFile(filePath)).toString(`utf-8`)

        if (!replace_all) {
          const first = original.indexOf(old_string)
          if (first === -1) {
            return {
              content: [
                {
                  type: `text` as const,
                  text: `Error: old_string not found in ${rel}`,
                },
              ],
              details: { replacements: 0 },
            }
          }
          const second = original.indexOf(old_string, first + 1)
          if (second !== -1) {
            const matches = original.split(old_string).length - 1
            return {
              content: [
                {
                  type: `text` as const,
                  text: `Error: found ${matches} matches for old_string in ${rel}; pass replace_all=true to replace all, or provide a more specific old_string.`,
                },
              ],
              details: { replacements: 0 },
            }
          }
          const updated =
            original.slice(0, first) +
            new_string +
            original.slice(first + old_string.length)
          await sandbox.writeFile(filePath, updated)
          const patch = createTwoFilesPatch(rel, rel, original, updated)
          return {
            content: [
              {
                type: `text` as const,
                text: `Edited ${rel}: 1 replacement`,
              },
            ],
            details: { replacements: 1, diff: patch },
          }
        }

        const parts = original.split(old_string)
        const count = parts.length - 1
        if (count === 0) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error: old_string not found in ${rel}`,
              },
            ],
            details: { replacements: 0 },
          }
        }
        const updated = parts.join(new_string)
        await sandbox.writeFile(filePath, updated)
        const patch = createTwoFilesPatch(rel, rel, original, updated)
        return {
          content: [
            {
              type: `text` as const,
              text: `Edited ${rel}: ${count} occurrences replaced`,
            },
          ],
          details: { replacements: count, diff: patch },
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
            details: { replacements: 0 },
          }
        }
        runtimeLog.warn(
          `[edit tool]`,
          `failed to edit ${filePath}: ${err instanceof Error ? err.message : String(err)}`
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error editing file: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { replacements: 0 },
        }
      }
    },
  }
}
