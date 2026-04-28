import { db } from '@electric-ax/agents-runtime'
import { Type } from '@sinclair/typebox'
import { z } from 'zod'
import type {
  AgentTool,
  EntityRegistry,
  SharedStateHandle,
} from '@electric-ax/agents-runtime'
import { chatroomSchema } from './schema.js'

export type ChatroomState = SharedStateHandle<typeof chatroomSchema>

export const DEFAULT_MODEL = `claude-sonnet-4-5-20250929`

const chatAgentArgs = z.object({ chatroomId: z.string().min(1) })

/** Register a chat agent that observes a shared chatroom and responds to messages */
export function registerChatAgent(
  registry: EntityRegistry,
  name: string,
  description: string,
  systemPrompt: string
): void {
  registry.define(name, {
    description,
    creationSchema: chatAgentArgs,

    async handler(ctx) {
      const args = chatAgentArgs.parse(ctx.args)

      if (ctx.firstWake) {
        ctx.mkdb(args.chatroomId, chatroomSchema)
      }

      const chatroom = (await ctx.observe(db(args.chatroomId, chatroomSchema), {
        wake: { on: `change`, collections: [`shared:message`] },
      })) as unknown as ChatroomState

      if (ctx.firstWake) return

      // Only respond if there's a user message we haven't replied to yet
      const allMessages = (chatroom.messages as any).toArray as Array<{
        role: string
        sender: string
        timestamp: number
      }>
      const sorted = [...allMessages].sort((a, b) => a.timestamp - b.timestamp)
      let lastUserIdx = -1
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i]!.role === `user`) {
          lastUserIdx = i
          break
        }
      }
      if (lastUserIdx === -1) return // no user messages
      // Check if this agent already responded after the last user message
      const alreadyReplied = sorted
        .slice(lastUserIdx + 1)
        .some((m) => m.sender === ctx.entityUrl)
      if (alreadyReplied) return

      ctx.useContext({
        sourceBudget: 50_000,
        sources: {
          conversation: {
            cache: `volatile`,
            content: async () => getConversationHistory(chatroom),
          },
        },
      })

      ctx.useAgent({
        systemPrompt,
        model: DEFAULT_MODEL,
        tools: [
          createSendMessageTool(chatroom.messages, ctx.entityUrl, name),
          createWebSearchTool(),
        ],
      })
      await ctx.agent.run()
    },
  })
}

/** Read all messages from the shared state and format as conversation context */
function getConversationHistory(chatroom: ChatroomState): string {
  const messages = (chatroom.messages as any).toArray as Array<{
    senderName: string
    text: string
  }>
  if (messages.length === 0) return ``
  return (
    `\nConversation so far:\n` +
    messages.map((m) => `[${m.senderName}]: ${m.text}`).join(`\n`) +
    `\n`
  )
}

type MessageCollection = ChatroomState[`messages`]

/** Wait for a shared state write to be persisted to the durable stream */
async function awaitPersisted(transaction: unknown): Promise<void> {
  const promise = (
    transaction as { isPersisted?: { promise?: Promise<unknown> } } | null
  )?.isPersisted?.promise
  if (promise) await promise
}

const BRAVE_API_URL = `https://api.search.brave.com/res/v1/web/search`

function createWebSearchTool(): AgentTool {
  return {
    name: `web_search`,
    label: `Web Search`,
    description: `Search the web for current information to support your analysis.`,
    parameters: Type.Object({
      query: Type.String({ description: `The search query` }),
    }),
    execute: async (_toolCallId, params) => {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY
      if (!apiKey) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Web search unavailable: BRAVE_SEARCH_API_KEY not set.`,
            },
          ],
          details: {},
        }
      }

      const { query } = params as { query: string }
      const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=5`
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey },
      })
      if (!res.ok) {
        return {
          content: [
            { type: `text` as const, text: `Search failed: ${res.status}` },
          ],
          details: {},
        }
      }

      const data = (await res.json()) as {
        web?: {
          results?: Array<{ title: string; url: string; description: string }>
        }
      }
      const results = data.web?.results ?? []
      const formatted = results
        .map(
          (r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`
        )
        .join(`\n\n`)

      return {
        content: [
          { type: `text` as const, text: formatted || `No results found.` },
        ],
        details: { resultCount: results.length },
      }
    },
  }
}

function createSendMessageTool(
  messages: MessageCollection,
  entityUrl: string,
  displayName: string
): AgentTool {
  return {
    name: `send_message`,
    label: `Send Message`,
    description: `Post a message to the chatroom.`,
    parameters: Type.Object({
      text: Type.String({ description: `The message text to send` }),
    }),
    execute: async (_toolCallId, params) => {
      const { text } = params as { text: string }

      const transaction = (messages as any).insert({
        key: crypto.randomUUID(),
        role: `agent`,
        sender: entityUrl,
        senderName: displayName,
        text,
        timestamp: Date.now(),
      })
      await awaitPersisted(transaction)

      return {
        content: [{ type: `text` as const, text: `Message sent.` }],
        details: { text },
      }
    },
  }
}
