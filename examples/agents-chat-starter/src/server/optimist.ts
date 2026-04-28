import { db } from '@electric-ax/agents-runtime'
import { z } from 'zod'
import { chatroomSchema } from './schema.js'
import {
  createSendMessageTool,
  createWebSearchTool,
  getConversationHistory,
  DEFAULT_MODEL,
  type ChatroomState,
} from './shared-tools.js'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

const argsSchema = z.object({ chatroomId: z.string().min(1) })

const SYSTEM_PROMPT = `You are an Optimist in a shared chatroom. You wake whenever the conversation changes.

Read the conversation history in your context. If the latest message is from a user and relates to your expertise (positive analysis, opportunities, benefits), respond using send_message. Use web_search to find supporting evidence when helpful.

If the latest message is from another agent, or you have nothing new to add, do NOT call send_message — just end your turn silently.`

export function registerOptimist(registry: EntityRegistry): void {
  registry.define(`optimist`, {
    description: `Optimist analyst — focuses on opportunities and benefits`,
    creationSchema: argsSchema,

    async handler(ctx) {
      const args = argsSchema.parse(ctx.args)

      if (ctx.firstWake) {
        ctx.mkdb(args.chatroomId, chatroomSchema)
      }

      const chatroom = (await ctx.observe(db(args.chatroomId, chatroomSchema), {
        wake: { on: `change`, collections: [`shared:message`] },
      })) as unknown as ChatroomState

      if (ctx.firstWake) return

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
        systemPrompt: SYSTEM_PROMPT,
        model: DEFAULT_MODEL,
        tools: [
          createSendMessageTool(
            chatroom.messages,
            ctx.entityUrl,
            ctx.entityUrl
          ),
          createWebSearchTool(),
        ],
      })
      await ctx.agent.run()
    },
  })
}
