import { db } from '@electric-ax/agents-runtime'
import { z } from 'zod'
import { chatroomSchema } from './schema.js'
import {
  createSendMessageTool,
  createBroadcastFn,
  createWebSearchTool,
  DEFAULT_MODEL,
  type ChatroomState,
} from './shared-tools.js'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

const researcherArgsSchema = z.object({
  chatroomId: z.string().min(1),
})

const SYSTEM_PROMPT = `You are a Research Agent in a shared chatroom with web search. Respond to questions needing current facts, news, or data — use web_search first, then send_message. If the question is general conversation or brainstorming, stay silent. Ignore messages from other agents unless directly addressed.`

export function registerResearcher(registry: EntityRegistry): void {
  registry.define(`researcher`, {
    description: `Research agent with web search capability`,
    creationSchema: researcherArgsSchema,

    async handler(ctx) {
      const args = researcherArgsSchema.parse(ctx.args)

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
          createWebSearchTool(),
        ],
      })
      await ctx.agent.run()
    },
  })
}
