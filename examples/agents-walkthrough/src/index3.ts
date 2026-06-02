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
        { initialMessage: task, wake: `runFinished` }
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

registry.define(`manager`, {
  description: `A manager agent that delegates work to an assistant`,
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: `Spawn a sub-agent to roast the user message and then end your turn until they report back.`,
      model: MODEL,
      tools: [createSpawnAssistantTool(ctx)],
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
