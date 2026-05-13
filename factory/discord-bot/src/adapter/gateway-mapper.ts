import type { DiscordWakeMessage } from '../wake-message'

interface RawDiscordMessage {
  id: string
  channel_id: string
  author: { id: string; username: string; bot?: boolean }
  content: string
  mentions: Array<{ id: string }>
  referenced_message: { id: string } | null
  thread: { id: string } | null
  attachments: Array<{
    id: string
    url: string
    content_type?: string
    filename?: string
  }>
}

export type GatewayMapInput = {
  botUserId: string
  message: RawDiscordMessage
  channelIsThread: boolean
}

export type GatewayMapOutput =
  | (DiscordWakeMessage & { kind: `thread_msg` })
  | {
      kind: `pre_thread_mention`
      channelId: string
      messageId: string
      userId: string
      content: string
      referencedMessageId?: string
    }
  | null

function stripMentions(content: string): string {
  return content.replace(/<@!?[\w]+>/g, ``).trim()
}

export function mapMessageCreate(input: GatewayMapInput): GatewayMapOutput {
  const { botUserId, message, channelIsThread } = input
  if (message.author.bot && message.author.id === botUserId) return null

  if (channelIsThread) {
    return {
      kind: `thread_msg`,
      threadId: message.channel_id,
      userId: message.author.id,
      content: stripMentions(message.content),
      referencedMessageId: message.referenced_message?.id,
      attachments: message.attachments.map((a) => ({
        id: a.id,
        url: a.url,
        contentType: a.content_type,
        filename: a.filename,
      })),
      idempotencyKey: message.id,
    }
  }

  // Non-thread channel: only react to direct mentions.
  if (!message.mentions.some((m) => m.id === botUserId)) return null
  return {
    kind: `pre_thread_mention`,
    channelId: message.channel_id,
    messageId: message.id,
    userId: message.author.id,
    content: stripMentions(message.content),
    referencedMessageId: message.referenced_message?.id ?? undefined,
  }
}
