import { Type } from '@sinclair/typebox'
import type { AgentTool, SharedStateHandle } from '@electric-ax/agents-runtime'
import { chatroomSchema } from './schema.js'

export type ChatroomState = SharedStateHandle<typeof chatroomSchema>

export const DEFAULT_MODEL = `claude-sonnet-4-5-20250929`

const BRAVE_API_URL = `https://api.search.brave.com/res/v1/web/search`

/** Create a function that broadcasts an agent message to other agents in the room */
export function createBroadcastFn(
  chatroomId: string,
  entityUrl: string
): (text: string, senderName: string) => Promise<void> {
  return async (text, senderName) => {
    const serverUrl =
      process.env.SERVE_URL ?? `http://localhost:${process.env.PORT ?? 4700}`
    await fetch(`${serverUrl}/api/rooms/${chatroomId}/broadcast`, {
      method: `POST`,
      headers: { 'Content-Type': `application/json` },
      body: JSON.stringify({
        text,
        from: senderName,
        excludeEntity: entityUrl,
      }),
    }).catch(() => {})
  }
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: `text` as const, text }],
    details,
  }
}

type MessageCollection = ChatroomState[`messages`]

/** Wait for a shared state write to be persisted to the durable stream */
async function awaitPersisted(transaction: unknown): Promise<void> {
  const promise = (
    transaction as { isPersisted?: { promise?: Promise<unknown> } } | null
  )?.isPersisted?.promise
  if (promise) await promise
}

export function createSendMessageTool(
  messages: MessageCollection,
  entityUrl: string,
  displayName: string,
  broadcastFn?: (text: string, senderName: string) => Promise<void>
): AgentTool {
  return {
    name: `send_message`,
    label: `Send Message`,
    description: `Post a message to the chatroom. Use this to share your response with the user and other agents.`,
    parameters: Type.Object({
      text: Type.String({ description: `The message text to send` }),
    }),
    execute: async (_toolCallId, params) => {
      const { text } = params as { text: string }

      // Write to shared state (for frontend)
      const transaction = (messages as any).insert({
        key: crypto.randomUUID(),
        role: `agent`,
        sender: entityUrl,
        senderName: displayName,
        text,
        timestamp: Date.now(),
      })
      await awaitPersisted(transaction)

      // Broadcast to other agents in the room
      if (broadcastFn) {
        await broadcastFn(text, displayName).catch(() => {})
      }

      return textResult(`Message sent.`, { text })
    },
  }
}

export function createWebSearchTool(): AgentTool {
  return {
    name: `web_search`,
    label: `Web Search`,
    description: `Search the web for current information. Returns titles, URLs, and snippets.`,
    parameters: Type.Object({
      query: Type.String({ description: `The search query` }),
    }),
    execute: async (_toolCallId, params) => {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY
      if (!apiKey) {
        return textResult(
          `Web search unavailable: BRAVE_SEARCH_API_KEY not set. Respond based on your existing knowledge instead.`,
          { resultCount: 0 }
        )
      }

      const { query } = params as { query: string }
      const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=5`
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey },
      })
      if (!res.ok) {
        return textResult(`Search failed: ${res.status} ${res.statusText}`, {
          resultCount: 0,
        })
      }

      const data = (await res.json()) as {
        web?: {
          results?: Array<{ title: string; url: string; description: string }>
        }
      }
      const results = data.web?.results ?? []
      if (results.length === 0) {
        return textResult(`No results found for "${query}"`, {
          resultCount: 0,
        })
      }

      const formatted = results
        .map(
          (result, index) =>
            `${index + 1}. **${result.title}**\n   ${result.url}\n   ${result.description}`
        )
        .join(`\n\n`)
      return textResult(formatted, { resultCount: results.length })
    },
  }
}
