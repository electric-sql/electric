import { describe, expect, it } from 'vitest'
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai'
import {
  buildStreamFixture,
  createTestHandlerContext,
} from './helpers/context-test-helpers'
import type { ChangeEvent } from '@durable-streams/state'

// Gated live test: drives the real agent runtime and makes a REAL summarization
// call to Anthropic. Requires a STANDARD api key (sk-ant-api…, used as
// x-api-key), not an OAuth token. Run with:
//   LIVE_ANTHROPIC_API_KEY="$(cat /tmp/anthropic_key)" \
//   RUN_LIVE_COMPACTION=1 npx vitest run test/compaction-live.test.ts
const LIVE = Boolean(process.env.RUN_LIVE_COMPACTION)

function stubbedAgentReply(): unknown {
  return {
    role: `assistant`,
    content: [{ type: `text`, text: `ok` }],
    api: `anthropic-messages`,
    provider: `anthropic`,
    model: `stub`,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: `stop`,
    timestamp: Date.now(),
  }
}

describe.skipIf(!LIVE)(`LIVE compaction with a real model`, () => {
  it(`summarizes a real conversation and persists the checkpoint`, async () => {
    const model = process.env.LIVE_MODEL ?? `claude-haiku-4-5-20251001`
    const apiKey = process.env.LIVE_ANTHROPIC_API_KEY
    expect(
      apiKey,
      `LIVE_ANTHROPIC_API_KEY must be a sk-ant-api… key`
    ).toBeTruthy()

    // A realistic multi-topic conversation, inflated so the history exceeds the
    // (small, test) window's half — and a step reporting 95% of that window so
    // the 90% ceiling fires.
    const conversation = [
      `We are building a CLI todo app in Rust. We chose clap for argument parsing and serde_json to persist tasks in ~/.todos.json.`,
      `Implemented the add, list, and done subcommands. "done" marks a task complete by its 1-based index in the list.`,
      `Open decisions: the user prefers minimal dependencies and wants colored terminal output via the owo-colors crate.`,
      `Still TODO: an "rm" subcommand to delete tasks, optional due dates (parsed with chrono), and a --json output mode for scripting.`,
      `A bug was found: completing a task shifts indices, so completing two in a row by index hits the wrong task. We plan to switch to stable task IDs.`,
    ]
      .join(`\n\n`)
      .repeat(30)

    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: conversation } },
    ])
    ;(
      db.collections as unknown as { steps: { insert: (r: unknown) => void } }
    ).steps.insert({
      key: `step-1`,
      _seq: 1,
      run_id: `r`,
      step_number: 1,
      status: `completed`,
      context_input_tokens: 3800,
      context_window: 4000,
    })

    const writes: Array<ChangeEvent> = []
    const { ctx } = createTestHandlerContext({
      db,
      writeEvent: (event: ChangeEvent) => {
        writes.push(event)
        db.utils.applyEvent(event)
      },
    })

    ctx.useAgent({
      systemPrompt: `You are a helpful coding assistant.`,
      model,
      provider: `anthropic`,
      tools: [],
      getApiKey: () => apiKey,
      // Stub the agent's own reply so ONLY the summarization hits the real API.
      streamFn: ((_model: unknown) => {
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => stream.end(stubbedAgentReply() as never))
        return stream
      }) as never,
      // summarizeComplete left undefined → real pi-ai completeSimple (real model)
    })

    await ctx.agent.run(`Please continue with the rm subcommand.`)

    const checkpoint = writes.find(
      (event) =>
        (event.value as { attrs?: { kind?: string } } | undefined)?.attrs
          ?.kind === `compaction`
    )
    expect(checkpoint, `compaction checkpoint must be persisted`).toBeTruthy()

    const summary = String(
      (checkpoint!.value as { content?: unknown }).content ?? ``
    )

    console.log(
      `\n===== REAL MODEL SUMMARY (${model}) =====\n${summary}\n========================================\n`
    )

    expect(summary).toContain(`Another language model started`) // Codex prefix
    expect(summary.length).toBeGreaterThan(150)

    // The summary should mention concrete facts from the conversation.
    const mentions = [`rust`, `todo`, `clap`, `index`, `rm`].filter((term) =>
      summary.toLowerCase().includes(term)
    )
    expect(
      mentions.length,
      `summary should retain key facts; matched: ${mentions.join(`,`)}`
    ).toBeGreaterThanOrEqual(2)
  }, 60_000)
})
