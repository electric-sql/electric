import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@electric-ax/agents-runtime'
import type { DiscordRest } from '../discord-rest'

export interface DiscordToolsOptions {
  rest: DiscordRest
}

const text = (s: string) => ({
  content: [{ type: `text` as const, text: s }],
  details: {} as Record<string, unknown>,
})

export function createDiscordTools({
  rest,
}: DiscordToolsOptions): Array<AgentTool> {
  const postMessage: AgentTool = {
    name: `post_message`,
    label: `Post Discord message`,
    description: `Post a message to a Discord channel or thread.`,
    parameters: Type.Object({
      channelId: Type.String(),
      content: Type.String({ maxLength: 2000 }),
    }),
    async execute(_id, params) {
      const { channelId, content } = params as {
        channelId: string
        content: string
      }
      const msg = (await rest.post(`/channels/${channelId}/messages`, {
        content,
      })) as {
        id: string
      }
      const out = text(`Posted message ${msg.id}`)
      out.details = { messageId: msg.id, channelId }
      return out
    },
  }

  const editMessage: AgentTool = {
    name: `edit_message`,
    label: `Edit Discord message`,
    description: `Edit a previously-posted message by id.`,
    parameters: Type.Object({
      channelId: Type.String(),
      messageId: Type.String(),
      content: Type.String({ maxLength: 2000 }),
    }),
    async execute(_id, params) {
      const { channelId, messageId, content } = params as {
        channelId: string
        messageId: string
        content: string
      }
      await rest.patch(`/channels/${channelId}/messages/${messageId}`, {
        content,
      })
      return text(`Edited message ${messageId}`)
    },
  }

  const createThread: AgentTool = {
    name: `create_thread`,
    label: `Create Discord thread`,
    description: `Create a thread from an existing message.`,
    parameters: Type.Object({
      channelId: Type.String(),
      messageId: Type.String(),
      name: Type.String({ maxLength: 100 }),
      autoArchiveMinutes: Type.Optional(Type.Integer()),
    }),
    async execute(_id, params) {
      const { channelId, messageId, name, autoArchiveMinutes } = params as {
        channelId: string
        messageId: string
        name: string
        autoArchiveMinutes?: number
      }
      const t = (await rest.post(
        `/channels/${channelId}/messages/${messageId}/threads`,
        {
          name,
          auto_archive_duration: autoArchiveMinutes ?? 1440,
        }
      )) as { id: string }
      const out = text(`Created thread ${t.id}`)
      out.details = { threadId: t.id }
      return out
    },
  }

  const readThreadHistory: AgentTool = {
    name: `read_thread_history`,
    label: `Read thread history`,
    description: `Read recent messages from a thread.`,
    parameters: Type.Object({
      threadId: Type.String(),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params) {
      const { threadId, limit = 20 } = params as {
        threadId: string
        limit?: number
      }
      const msgs = (await rest.get(
        `/channels/${threadId}/messages?limit=${limit}`
      )) as Array<{ id: string; author: { username: string }; content: string }>
      const formatted = msgs
        .reverse()
        .map((m) => `${m.author.username}: ${m.content}`)
        .join(`\n`)
      return text(formatted || `(no messages)`)
    },
  }

  const addReaction: AgentTool = {
    name: `add_reaction`,
    label: `Add reaction`,
    description: `Add an emoji reaction to a message.`,
    parameters: Type.Object({
      channelId: Type.String(),
      messageId: Type.String(),
      emoji: Type.String(),
    }),
    async execute(_id, params) {
      const { channelId, messageId, emoji } = params as {
        channelId: string
        messageId: string
        emoji: string
      }
      const enc = encodeURIComponent(emoji)
      await rest.put(
        `/channels/${channelId}/messages/${messageId}/reactions/${enc}/@me`,
        undefined
      )
      return text(`Reacted ${emoji}`)
    },
  }

  const readAround: AgentTool = {
    name: `read_channel_around_message`,
    label: `Read messages around a reference`,
    description: `Fetch a window of messages around a reference message id.`,
    parameters: Type.Object({
      channelId: Type.String(),
      messageId: Type.String(),
      before: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
      after: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    }),
    async execute(_id, params) {
      const {
        channelId,
        messageId,
        before = 20,
        after = 5,
      } = params as {
        channelId: string
        messageId: string
        before?: number
        after?: number
      }
      const [beforeMsgs, afterMsgs] = await Promise.all([
        before > 0
          ? rest.get<
              Array<{
                id: string
                author: { username: string }
                content: string
              }>
            >(
              `/channels/${channelId}/messages?before=${messageId}&limit=${before}`
            )
          : Promise.resolve([]),
        after > 0
          ? rest.get<
              Array<{
                id: string
                author: { username: string }
                content: string
              }>
            >(
              `/channels/${channelId}/messages?after=${messageId}&limit=${after}`
            )
          : Promise.resolve([]),
      ])
      const all = [...beforeMsgs.reverse(), ...afterMsgs]
      return text(
        all.map((m) => `${m.author.username}: ${m.content}`).join(`\n`)
      )
    },
  }

  return [
    postMessage,
    editMessage,
    createThread,
    readThreadHistory,
    addReaction,
    readAround,
  ]
}
