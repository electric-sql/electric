import { Type, type Static } from '@sinclair/typebox'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import {
  createEntityRegistry,
  createRuntimeHandler,
  type HandlerContext,
} from '@electric-ax/agents-runtime'

const PORT = 3000
const SERVE_URL = `http://localhost:${PORT}`
const ELECTRIC_AGENTS_URL = `http://localhost:4437`
const MODEL = `claude-sonnet-4-6`

const app = new Hono()

const registry = createEntityRegistry()

const genId = () => Math.random().toString()

const taskParameters = Type.Object({
  task: Type.String({ description: `The task for the assistant.` }),
})
type TaskParams = Static<typeof taskParameters>

function createSpawnAssistantTool(ctx: HandlerContext) {
  return {
    name: `spawn_assistant`,
    label: `Spawn Assistant`,
    description: `Spawn an assistant sub-agent to perform a task.`,
    parameters: taskParameters,
    execute: async (_toolCallId: string, params: unknown) => {
      const { task } = params as TaskParams
      const { entityUrl } = await ctx.spawn(
        `assistant`,
        genId(),
        {},
        {
          initialMessage: task,
          wake: { on: `runFinished`, includeResponse: true },
        }
      )

      return {
        content: [
          {
            type: `text` as const,
            text: `Assistant dispatched at ${entityUrl}.`,
          },
        ],
        details: { entityUrl },
        terminate: true,
      }
    },
  }
}

registry.define(`assistant`, {
  description: `A general-purpose AI assistant`,
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt:
        (ctx.args.systemPrompt as string) || `You are a helpful assistant.`,
      model: MODEL,
      tools: [],
    })

    await ctx.agent.run()
  },
})

const topicParameters = Type.Object({
  topic: Type.String({ description: `The topic to debate.` }),
})
type TopicParams = Static<typeof topicParameters>

function createSpawnJudgeTool(ctx: HandlerContext) {
  return {
    name: `spawn_judge`,
    label: `Spawn Judge`,
    description: `Spawn a judge agent that coordinates a two-sided debate and reports the result back here. Use this when the user asks agents to debate a topic.`,
    parameters: topicParameters,
    execute: async (_toolCallId: string, params: unknown) => {
      const { topic } = params as TopicParams
      const { entityUrl } = await ctx.spawn(
        `judge`,
        genId(),
        {},
        {
          initialMessage: `Set up a debate on this topic: ${topic}`,
          wake: { on: `runFinished`, includeResponse: true },
        }
      )

      return {
        content: [
          {
            type: `text` as const,
            text: `Judge dispatched at ${entityUrl}.`,
          },
        ],
        details: { entityUrl },
        terminate: true,
      }
    },
  }
}

registry.define(`judge`, {
  description: `A judge that coordinates a two-sided debate`,
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: `You are a fair, concise judge coordinating a multi-agent debate.

Your job is to:
1. Spawn exactly two assistant sub-agents:
   - "A" side debater: argues one case (e.g.: beneficial / pro / one side of the argument)
   - "B" side debater: argues the other case (e.g.: harmful  / against / the other side)
2. Give each assistant a clear brief with the debate topic and the side they must argue.
3. Ask each assistant to respond to you with a concise argument and their strongest three points.
4. End your turn after spawning them. When each assistant finishes, wait until you have both responses.
5. Summarize the key arguments of the debate and provide your judge's verdict to the parent agent.

Notes:
- You are an impartial judge.
- Use the assistants to gather the two sides.
- Wait for **all** of the assistants to return **full** responses. Don't respond to partial / in-progress responses.
- Do not generate/hallucinate the argument yourself. You must wait for the assistants to fully respond and then synthesize their responses. Don't anticipate or make them up.
- Wait until the debate is fully finished before reporting back to the parent agent.`,
      model: MODEL,
      tools: [createSpawnAssistantTool(ctx)],
    })

    await ctx.agent.run()
  },
})

registry.define(`manager`, {
  description: `A manager agent that delegates work to an assistant`,
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: `
        When asked to debate a topic, spawn a Judge with the debate topic.

        When given a user message that is a single word, spawn an
        assistant to reverse the user message.

        When asked direct questions, answer them yourself.
      `,
      model: MODEL,
      tools: [createSpawnAssistantTool(ctx), createSpawnJudgeTool(ctx)],
    })

    await ctx.agent.run()
  },
})

const runtime = createRuntimeHandler({
  baseUrl: ELECTRIC_AGENTS_URL,
  serveEndpoint: `${SERVE_URL}/electric-agents`,
  registry,
})

app.get(`/`, (c) => {
  return c.text(`Hello Hono!`)
})

app.post(`/electric-agents`, (c) => {
  return runtime.handleWebhookRequest(c.req.raw)
})

serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)

    runtime.registerTypes().catch(console.error)
  }
)
