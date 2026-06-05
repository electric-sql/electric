import { Type, type Static } from '@sinclair/typebox'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import {
  createEntityRegistry,
  createRuntimeHandler,
  entity,
  passthrough,
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

type Debate = {
  key: `current`
  topic: string
  aUrl: string
  bUrl: string
  phase: `arguing` | `critiquing` | `done`
  arguments: { a?: string; b?: string }
  rebuttals: { a?: boolean; b?: boolean }
}

// The shape of a finished child on a `wake` notification's payload.
type FinishedChild = {
  url: string
  type: string
  run_status: `completed` | `failed`
  response?: string
}

const startDebateParameters = Type.Object({
  topic: Type.String({
    description: `Short topic line, e.g. "996 vs 4-day work week".`,
  }),
  aBrief: Type.String({
    description: `Brief for the A debater: topic, side, ask for their concise argument and points.`,
  }),
  bBrief: Type.String({ description: `Brief for the B debater: same shape.` }),
})
type StartDebateParams = Static<typeof startDebateParameters>

// `ctx` is typed loosely here: this tool is created inside the judge's handler,
// whose state (`debate`) is specifically typed, which `HandlerContext` defaults
// would reject. The judge handler that owns the state stays fully typed.
function createStartDebateTool(ctx: HandlerContext<any, any, any, any>) {
  return {
    name: `start_debate`,
    label: `Start Debate`,
    description: `Spawn the two debaters with their opening briefs. Call exactly once.`,
    parameters: startDebateParameters,
    execute: async (_id: string, params: unknown) => {
      const { topic, aBrief, bBrief } = params as StartDebateParams
      const [a, b] = await Promise.all([
        ctx.spawn(
          `assistant`,
          genId(),
          {},
          {
            initialMessage: aBrief,
            wake: { on: `runFinished`, includeResponse: true },
          }
        ),
        ctx.spawn(
          `assistant`,
          genId(),
          {},
          {
            initialMessage: bBrief,
            wake: { on: `runFinished`, includeResponse: true },
          }
        ),
      ])

      ctx.state.debate.insert({
        key: `current`,
        topic,
        aUrl: a.entityUrl,
        bUrl: b.entityUrl,
        phase: `arguing`,
        arguments: {},
        rebuttals: {},
      })

      return {
        content: [
          {
            type: `text` as const,
            text: `Debate started.`,
          },
        ],
        details: {},
        terminate: true,
      }
    },
  }
}

const rebut = (arg: string) =>
  `Your opponent argued:\n\n${arg}\n\nRebut their argument(s).`

const SETUP_PROMPT = `You are a fair, concise debate judge opening a debate.
Call start_debate exactly once: pick the topic line, and write a clear brief for each side:
- "A" argues one case (e.g.: beneficial / pro / one side of the argument)
- "B" argues the other case (e.g.: harmful  / against / the other side)
Each brief assigns only the topic and that side's position, then asks the debater to make a
concise argument with their own three strongest points. Do NOT supply, list, or hint at any
arguments yourself — the debater must devise their own.
Then end your turn. Do not narrate.`

const VERDICT_PROMPT = `You are a fair, concise debate judge closing a debate.
Both sides have argued and critiqued each other. The full exchange is in your context.
Weigh it and write your final verdict as your reply: summarise each side's strongest points,
note how each critique landed, and give your impartial decision. Never argue a side.
Do not narrate or preface — your reply IS the verdict, and it gets relayed to the user.`

registry.define(`judge`, {
  description: `Coordinates a three-phase debate: arguments, mutual rebuttals, verdict.`,
  state: {
    debate: { schema: passthrough<Debate>(), primaryKey: `key` },
  },
  async handler(ctx, wake) {
    // Handle inbox messages by spawning one debate at a time.
    // Using the LLM to formulate the briefs for each side.

    if (wake.type === `inbox`) {
      if (ctx.state.debate.get(`current`)) {
        return ctx.sleep()
      }

      ctx.useAgent({
        systemPrompt: SETUP_PROMPT,
        model: MODEL,
        tools: [createStartDebateTool(ctx)],
      })

      await ctx.agent.run()
      return
    }

    // Ignore wake notifications unless they're from finished children
    // participating in the current debate.

    let debate = ctx.state.debate.get(`current`)
    if (!debate || debate.phase === `done`) {
      return ctx.sleep()
    }

    const finished_child = (
      wake.payload as { finished_child?: FinishedChild } | undefined
    )?.finished_child
    if (!finished_child) {
      return ctx.sleep()
    }

    const side =
      finished_child.url === debate.aUrl
        ? `a`
        : finished_child.url === debate.bUrl
          ? `b`
          : null
    if (!side) {
      return ctx.sleep()
    }

    // Record this debater's contribution for the current round.

    if (debate.phase === `arguing`) {
      ctx.state.debate.update(`current`, (d) => {
        d.arguments[side] = finished_child.response ?? ``
      })
      debate = ctx.state.debate.get(`current`)!

      // Proceed once both debaters have reported for this round.

      if (
        debate.arguments.a !== undefined &&
        debate.arguments.b !== undefined
      ) {
        ctx.send(debate.aUrl, rebut(debate.arguments.b))
        ctx.send(debate.bUrl, rebut(debate.arguments.a))

        ctx.state.debate.update(`current`, (d) => {
          d.phase = `critiquing`
        })
      }

      return ctx.sleep()
    }

    // We're in `phase === 'critiquing'`, wait until both are in.

    ctx.state.debate.update(`current`, (d) => {
      d.rebuttals[side] = true
    })
    debate = ctx.state.debate.get(`current`)!

    if (!debate.rebuttals.a || !debate.rebuttals.b) {
      return ctx.sleep()
    }

    // Flip the phase to 'done' and have the LLM write the verdict as its reply.

    ctx.state.debate.update(`current`, (d) => {
      d.phase = `done`
    })

    ctx.useAgent({
      systemPrompt: VERDICT_PROMPT,
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
    description: `Spawn a judge that runs a two-sided debate and reports the verdict back. Use when the user asks for a debate.`,
    parameters: topicParameters,
    execute: async (_id: string, params: unknown) => {
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

registry.define(`manager`, {
  description: `Delegates to assistants and judges and relays their results to the user.`,
  async handler(ctx, wake) {
    if (wake.type === `wake`) {
      const finishedChild = (
        wake.payload as { finished_child?: FinishedChild } | undefined
      )?.finished_child

      if (
        finishedChild?.type === `judge` &&
        finishedChild.run_status === `completed`
      ) {
        const judge = await ctx.observe(entity(finishedChild.url))

        const debate = judge.db.collections.debate.get(`current`) as
          | Debate
          | undefined
        if (debate?.phase !== `done`) {
          return ctx.sleep()
        }
      }
    }

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
