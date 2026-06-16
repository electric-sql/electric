import { resolve } from 'node:path'
import { Type } from '@sinclair/typebox'
import { runtimeLog } from '../log'
import { SandboxError } from '../sandbox/types'
import type { Sandbox } from '../sandbox/types'
import type { AgentTool } from '@mariozechner/pi-agent-core'

const MAX_FILE_SIZE = 512 * 1024 // 512 KB
const DEFAULT_READ_LIMIT_LINES = 2_000
const MAX_OUTPUT_BYTES = 50 * 1024
const MAX_OUTPUT_BYTES_LABEL = `${MAX_OUTPUT_BYTES / 1024} KB`
const MAX_LINE_LENGTH = 2_000
const BINARY_SAMPLE_BYTES = 8 * 1024
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== `number` || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function splitLines(text: string): Array<string> {
  const lines = text.split(/\r?\n/)
  if (lines.length > 1 && lines.at(-1) === ``) lines.pop()
  return lines
}

function formatReadOutput(
  filePath: string,
  text: string,
  opts: { offset: number; limit: number }
): {
  text: string
  charCount: number
  shownBytes: number
  startLine: number
  endLine: number
  shownLines: number
  totalLines: number
  truncated: boolean
} {
  const lines = splitLines(text)
  const totalLines = lines.length === 1 && lines[0] === `` ? 0 : lines.length

  if (totalLines === 0) {
    const output = [
      `<path>${filePath}</path>`,
      `<content>`,
      `(Empty file)`,
      `</content>`,
    ].join(`\n`)
    return {
      text: output,
      charCount: output.length,
      shownBytes: 0,
      startLine: 0,
      endLine: 0,
      shownLines: 0,
      totalLines: 0,
      truncated: false,
    }
  }

  const startIndex = opts.offset - 1
  if (startIndex >= totalLines) {
    return {
      text: `Error: Offset ${opts.offset} is out of range for this file (${totalLines} lines)`,
      charCount: 0,
      shownBytes: 0,
      startLine: opts.offset,
      endLine: opts.offset,
      shownLines: 0,
      totalLines,
      truncated: false,
    }
  }

  const renderedLines: Array<string> = []
  let shownBytes = 0
  let stoppedByBytes = false
  let endLine = opts.offset - 1

  for (let index = startIndex; index < totalLines; index++) {
    if (renderedLines.length >= opts.limit) break

    const rawLine = lines[index] ?? ``
    const displayLine =
      rawLine.length > MAX_LINE_LENGTH
        ? rawLine.slice(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
        : rawLine
    const rendered = `${index + 1}: ${displayLine}`
    const renderedBytes =
      Buffer.byteLength(rendered, `utf8`) + (renderedLines.length > 0 ? 1 : 0)

    if (shownBytes + renderedBytes > MAX_OUTPUT_BYTES) {
      stoppedByBytes = true
      break
    }

    renderedLines.push(rendered)
    shownBytes += renderedBytes
    endLine = index + 1
  }

  const nextLine = endLine + 1
  const hasMoreLines = nextLine <= totalLines
  const truncated = stoppedByBytes || hasMoreLines
  let output = [`<path>${filePath}</path>`, `<content>`].join(`\n`)
  if (renderedLines.length > 0) output += `\n${renderedLines.join(`\n`)}`

  if (stoppedByBytes) {
    output += `\n\n(Output capped at ${MAX_OUTPUT_BYTES_LABEL} of file content. Showing lines ${opts.offset}-${endLine}. Use offset=${nextLine} to continue.)`
  } else if (hasMoreLines) {
    output += `\n\n(Showing lines ${opts.offset}-${endLine} of ${totalLines}. Use offset=${nextLine} to continue.)`
  } else {
    output += `\n\n(End of file - total ${totalLines} lines)`
  }
  output += `\n</content>`

  return {
    text: output,
    charCount: output.length,
    shownBytes,
    startLine: opts.offset,
    endLine,
    shownLines: renderedLines.length,
    totalLines,
    truncated,
  }
}

export function createReadFileTool(
  sandbox: Sandbox,
  readSet?: Set<string>
): AgentTool {
  return {
    name: `read`,
    label: `Read File`,
    description: `Read the contents of a text file. Path must be relative to or within the working directory. Returns at most 2000 lines or 50KB of file content by default; use offset and limit to read specific sections. Binary files and files over 512KB are rejected. Lines longer than 2000 characters are truncated.`,
    parameters: Type.Object({
      path: Type.String({
        description: `File path (relative to working directory)`,
      }),
      offset: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: `1-based line number to start reading from`,
        })
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          description: `Maximum number of lines to return; defaults to 2000`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const {
        path: filePath,
        offset: rawOffset,
        limit: rawLimit,
      } = params as { path: string; offset?: number; limit?: number }
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
                text: `Error: File is too large (${(fileStat.size / 1024).toFixed(0)}KB > ${MAX_FILE_SIZE / 1024}KB limit). Use shell tools such as sed/head/tail for targeted inspection.`,
              },
            ],
            details: { charCount: 0, totalBytes: fileStat.size },
          }
        }

        const buffer = await sandbox.readFile(filePath)

        // Detect binary: check for null bytes in the first bytes (same basic heuristic git/grep use).
        const sample = buffer.subarray(0, BINARY_SAMPLE_BYTES)
        if (sample.includes(0)) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error: "${filePath}" appears to be a binary file`,
              },
            ],
            details: { charCount: 0, totalBytes: fileStat.size, binary: true },
          }
        }

        const text = buffer.toString(`utf-8`)
        const formatted = formatReadOutput(filePath, text, {
          offset: positiveInteger(rawOffset, 1),
          limit: positiveInteger(rawLimit, DEFAULT_READ_LIMIT_LINES),
        })
        readSet?.add(resolve(sandbox.workingDirectory, filePath))
        return {
          content: [{ type: `text` as const, text: formatted.text }],
          details: {
            charCount: formatted.charCount,
            totalBytes: fileStat.size,
            shownBytes: formatted.shownBytes,
            startLine: formatted.startLine,
            endLine: formatted.endLine,
            shownLines: formatted.shownLines,
            totalLines: formatted.totalLines,
            truncated: formatted.truncated,
          },
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
