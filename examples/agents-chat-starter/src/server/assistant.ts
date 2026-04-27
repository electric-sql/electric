import { db } from '@electric-ax/agents-runtime'
import { z } from 'zod'
import { chatroomSchema } from './schema.js'
import {
  createSendMessageTool,
  createBroadcastFn,
  DEFAULT_MODEL,
  type ChatroomState,
} from './shared-tools.js'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

const assistantArgsSchema = z.object({
  chatroomId: z.string().min(1),
})

const SYSTEM_PROMPT = `You are a General Assistant in a shared chatroom. Respond to conversational questions, brainstorming, and explanations. If a question needs web research, stay silent — a Researcher agent will handle it. If unsure, respond. Use send_message to post replies. Ignore messages from other agents unless directly addressed.`

export function registerAssistant(registry: EntityRegistry): void {
  registry.define(`assistant`, {
    description: `General-purpose helpful chat agent`,
    creationSchema: assistantArgsSchema,

    async handler(ctx) {
      const args = assistantArgsSchema.parse(ctx.args)

      if (ctx.firstWake) {
        ctx.mkdb(args.chatroomId, chatroomSchema)
        return
      }

      const chatroom = (await ctx.observe(
        db(args.chatroomId, chatroomSchema)
      )) as unknown as ChatroomState

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
        ],
      })
      await ctx.agent.run()
    },
  })
}
