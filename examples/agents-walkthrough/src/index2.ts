import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import {
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agents-runtime'

const PORT = 3000
const SERVE_URL = `http://localhost:${PORT}`
const ELECTRIC_AGENTS_URL = `http://localhost:4437`
const MODEL = `claude-sonnet-4-6`

const app = new Hono()

const registry = createEntityRegistry()

const genId = () => Math.random().toString()

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
  description: `A manager agent that delegates work to assistants`,
  async handler(ctx, wake) {
    if (wake.type === `inbox`) {
      await ctx.spawn(
        `assistant`,
        genId(),
        {
          systemPrompt: `Reverse the user message.`,
        },
        {
          initialMessage: (wake.payload as { text: string }).text,
          wake: { on: `runFinished`, includeResponse: true },
        }
      )
    }

    ctx.useAgent({
      systemPrompt:
        (ctx.args.systemPrompt as string) || `You are a manager agent.`,
      model: MODEL,
      tools: [],
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
