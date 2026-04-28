import { db } from '@electric-ax/agents-runtime'
import { z } from 'zod'
import { chatroomSchema } from './schema.js'
import {
  createSendMessageTool,
  createWebSearchTool,
  createBroadcastFn,
  getConversationHistory,
  DEFAULT_MODEL,
  type ChatroomState,
} from './shared-tools.js'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

const argsSchema = z.object({ chatroomId: z.string().min(1) })

const SYSTEM_PROMPT = `You are a Critic in a shared chatroom. When the user asks a question, provide a sharp analysis focusing on risks, downsides, and challenges. Use web_search to find supporting evidence when helpful. Use send_message to post your response. If other agents have already covered the critical angle, add new points or stay silent.`

export function registerCritic(registry: EntityRegistry): void {
  registry.define(`critic`, {
    description: `Critical analyst — focuses on risks and challenges`,
    creationSchema: argsSchema,

    async handler(ctx) {
      const args = argsSchema.parse(ctx.args)

      if (ctx.firstWake) {
        ctx.mkdb(args.chatroomId, chatroomSchema)
        return
      }

      const chatroom = (await ctx.observe(
        db(args.chatroomId, chatroomSchema)
      )) as unknown as ChatroomState

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
            ctx.entityUrl,
            createBroadcastFn(args.chatroomId, ctx.entityUrl)
          ),
          createWebSearchTool(),
        ],
      })
      await ctx.agent.run()
    },
  })
}
