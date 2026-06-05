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

registry.define(`assistant`, {
  description: `A general-purpose AI assistant`,
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: `You are a helpful assistant.`,
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
