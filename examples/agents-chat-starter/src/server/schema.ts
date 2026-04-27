import { z } from 'zod'

export const messageSchema = z.object({
  key: z.string().min(1),
  role: z.enum([`user`, `agent`]),
  sender: z.string().min(1),
  senderName: z.string().min(1),
  text: z.string().min(1),
  timestamp: z.number(),
})

export type Message = z.infer<typeof messageSchema>

export const chatroomSchema = {
  messages: {
    schema: messageSchema,
    type: `shared:message`,
    primaryKey: `key`,
  },
} as const
