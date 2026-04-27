import { Type } from '@sinclair/typebox'
import type { AgentTool, SharedStateHandle } from '@electric-ax/agents-runtime'
import { chatroomSchema } from './schema.js'

export type ChatroomState = SharedStateHandle<typeof chatroomSchema>

export const DEFAULT_MODEL = `claude-sonnet-4-5-20250929`

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

/** Read all messages from the shared state and format as conversation context */
export function getConversationHistory(chatroom: ChatroomState): string {
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

export function createSendMessageTool(
  messages: MessageCollection,
  entityUrl: string,
  displayName: string,
  broadcastFn?: (text: string, senderName: string) => Promise<void>
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

      if (broadcastFn) {
        await broadcastFn(text, displayName).catch(() => {})
      }

      return {
        content: [{ type: `text` as const, text: `Message sent.` }],
        details: { text },
      }
    },
  }
}
