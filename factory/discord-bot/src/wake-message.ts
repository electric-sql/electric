import { z } from 'zod'

const attachmentSchema = z.object({
  id: z.string(),
  url: z.string(),
  contentType: z.string().optional(),
  filename: z.string().optional(),
})

const channelMessageSchema = z.object({
  id: z.string(),
  author: z.string(),
  content: z.string(),
  timestamp: z.number(),
})

export const discordWakeMessageSchema = z.discriminatedUnion(`kind`, [
  z.object({
    kind: z.literal(`mention`),
    threadId: z.string(),
    channelId: z.string(),
    userId: z.string(),
    content: z.string(),
    referencedMessageId: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
    primeMessages: z.array(channelMessageSchema).optional(),
    idempotencyKey: z.string().optional(),
  }),
  z.object({
    kind: z.literal(`thread_msg`),
    threadId: z.string(),
    userId: z.string(),
    content: z.string(),
    referencedMessageId: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
    idempotencyKey: z.string().optional(),
  }),
  z.object({
    kind: z.literal(`interaction`),
    threadId: z.string(),
    userId: z.string(),
    command: z.string(),
    options: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()])
    ),
    idempotencyKey: z.string().optional(),
  }),
  z.object({
    kind: z.literal(`thread_close`),
    threadId: z.string(),
    idempotencyKey: z.string().optional(),
  }),
])

export type DiscordWakeMessage = z.infer<typeof discordWakeMessageSchema>
export type ChannelMessage = z.infer<typeof channelMessageSchema>
