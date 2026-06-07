import { createTwoFilesPatch } from 'diff'
import { Type } from '@sinclair/typebox'
import type { AgentTool, ProcessWakeConfig } from '../types'

type ElectricToolContext = Parameters<
  NonNullable<ProcessWakeConfig[`createElectricTools`]>
>[0]

function docLabel(id: string): string {
  return `markdown-doc:${id}`
}

export function createMarkdownDocumentTools(
  context: ElectricToolContext
): Array<AgentTool> {
  const readDocs = new Map<string, string>()

  return [
    {
      name: `create_markdown_doc`,
      label: `Create Markdown Doc`,
      description: `Create a collaborative markdown document, persist it as Yjs updates, and add it to this entity's manifest so users can open it in the app. This is not a filesystem file.`,
      parameters: Type.Object({
        title: Type.String({ description: `Document title shown in the UI.` }),
        content: Type.Optional(
          Type.String({ description: `Initial markdown content.` })
        ),
        id: Type.Optional(
          Type.String({
            description: `Optional stable document id. Use letters, numbers, hyphens, or underscores.`,
          })
        ),
      }),
      execute: async (_toolCallId, params) => {
        const { id, title, content } = params as {
          id?: string
          title: string
          content?: string
        }
        const result = await context.createMarkdownDocument({
          id,
          title,
          content,
        })
        readDocs.set(result.document.id, content ?? ``)
        return {
          content: [
            {
              type: `text` as const,
              text: `Created markdown document ${result.document.id}: ${result.document.title}`,
            },
          ],
          details: { document: result.document, txid: result.txid },
        }
      },
    },
    {
      name: `read_markdown_doc`,
      label: `Read Markdown Doc`,
      description: `Read the current plain markdown content from a collaborative app document, not from the filesystem.`,
      parameters: Type.Object({
        id: Type.String({ description: `Document id.` }),
      }),
      execute: async (_toolCallId, params) => {
        const { id } = params as { id: string }
        const result = await context.readMarkdownDocument({ id })
        readDocs.set(id, result.content)
        return {
          content: [
            {
              type: `text` as const,
              text: result.content,
            },
          ],
          details: {
            document: result.document,
            bytes: new TextEncoder().encode(result.content).length,
          },
        }
      },
    },
    {
      name: `write_markdown_doc`,
      label: `Write Markdown Doc`,
      description: `Replace the full content of a collaborative app markdown document. This does not write a filesystem file.`,
      parameters: Type.Object({
        id: Type.String({ description: `Document id.` }),
        content: Type.String({ description: `Full markdown content.` }),
      }),
      execute: async (_toolCallId, params) => {
        const { id, content } = params as { id: string; content: string }
        const before =
          readDocs.get(id) ??
          (await context.readMarkdownDocument({ id })).content
        const result = await context.writeMarkdownDocument({ id, content })
        readDocs.set(id, content)
        const diff = createTwoFilesPatch(
          docLabel(id),
          docLabel(id),
          before,
          content,
          undefined,
          undefined,
          { context: 3 }
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Wrote markdown document ${id}`,
            },
          ],
          details: { document: result.document, txid: result.txid, diff },
        }
      },
    },
    {
      name: `edit_markdown_doc`,
      label: `Edit Markdown Doc`,
      description: `Replace text in a collaborative app markdown document, not a filesystem file. The document must be read with read_markdown_doc earlier in this wake. By default old_string must occur exactly once; set replace_all to true to replace every occurrence.`,
      parameters: Type.Object({
        id: Type.String({ description: `Document id.` }),
        old_string: Type.String({
          description: `Literal markdown text to find. Must be unique unless replace_all is true.`,
        }),
        new_string: Type.String({ description: `Replacement markdown text.` }),
        replace_all: Type.Optional(
          Type.Boolean({ description: `Replace every occurrence.` })
        ),
      }),
      execute: async (_toolCallId, params) => {
        const { id, old_string, new_string, replace_all } = params as {
          id: string
          old_string: string
          new_string: string
          replace_all?: boolean
        }
        const before = readDocs.get(id)
        if (before === undefined) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Document ${id} has not been read in this wake; call read_markdown_doc first.`,
              },
            ],
            details: { replacements: 0 },
          }
        }

        const matches = before.split(old_string).length - 1
        if (matches === 0) {
          return {
            content: [
              { type: `text` as const, text: `Error: old_string not found` },
            ],
            details: { replacements: 0 },
          }
        }
        if (!replace_all && matches > 1) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error: found ${matches} matches for old_string; pass replace_all=true or provide a more specific old_string.`,
              },
            ],
            details: { replacements: 0 },
          }
        }

        const result = await context.editMarkdownDocument({
          id,
          oldString: old_string,
          newString: new_string,
          replaceAll: replace_all,
        })
        readDocs.set(id, result.content)
        const diff = createTwoFilesPatch(
          docLabel(id),
          docLabel(id),
          before,
          result.content,
          undefined,
          undefined,
          { context: 3 }
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Edited markdown document ${id}: ${matches} replacement${
                matches === 1 ? `` : `s`
              }`,
            },
          ],
          details: { replacements: matches, document: result.document, diff },
        }
      },
    },
  ]
}
