/**
 * Benchmark for buildSections and its neighbors.
 *
 * Measures the pure-function cost of the projection from
 * normalized runs/inbox rows -> denormalized EntityTimelineSection[]
 * to decide whether useMemo wrapping it in React is worthwhile.
 *
 * Run with:  pnpm tsx packages/agent-runtime/scripts/bench-build-sections.ts
 */

import { performance } from 'node:perf_hooks'
import { buildSections } from '../src/use-chat'
import { normalizeEntityTimelineData } from '../src/entity-timeline'
import type {
  EntityTimelineData,
  IncludesInboxMessage,
  IncludesRun,
  IncludesText,
  IncludesToolCall,
} from '../src/entity-timeline'

// ---------- Synthetic data generation ----------

// Pad orders with leading zeros so localeCompare gives a lexicographic
// ordering that matches numeric ordering (matches real timeline order
// tokens which are also lexicographically sortable strings).
const order = (n: number): string => n.toString().padStart(12, `0`)

interface TimelineShape {
  exchanges: number // one "exchange" = user message + agent response
  textsPerResponse: number
  toolCallsPerResponse: number
}

function makeTextChunk(i: number, chunks: number): string {
  // Realistic-ish markdown: a few sentences, some with backticks.
  const base = `This is a representative chunk #${i} out of ${chunks} with some \`inline code\` and a bit more prose to approximate the kind of content an LLM typically streams back to the user. `
  return base.repeat(1)
}

function makeRun(runIndex: number, shape: TimelineShape): IncludesRun {
  const runKey = `run-${runIndex}`
  const texts: Array<IncludesText> = []
  const toolCalls: Array<IncludesToolCall> = []

  let orderCursor = runIndex * 10_000 + 1

  for (let t = 0; t < shape.textsPerResponse; t++) {
    texts.push({
      key: `${runKey}-text-${t}`,
      run_id: runKey,
      order: order(orderCursor++),
      status: t === shape.textsPerResponse - 1 ? `streaming` : `completed`,
      text: makeTextChunk(t, shape.textsPerResponse),
    })
  }

  for (let c = 0; c < shape.toolCallsPerResponse; c++) {
    toolCalls.push({
      key: `${runKey}-tc-${c}`,
      run_id: runKey,
      order: order(orderCursor++),
      tool_name: `search_${c % 3}`,
      status: `completed`,
      args: { query: `example query ${c}`, limit: 10 },
      result: [
        { id: `r-${c}`, title: `Result ${c}`, snippet: `...`.repeat(5) },
      ],
    })
  }

  return {
    key: runKey,
    order: order(runIndex * 10_000),
    status: `completed`,
    finish_reason: `stop`,
    texts,
    toolCalls,
    steps: [],
    errors: [],
  }
}

function makeInbox(messageIndex: number): IncludesInboxMessage {
  return {
    key: `inbox-${messageIndex}`,
    order: order(messageIndex * 10_000 - 1), // sort just before the run
    from: `user:alice`,
    payload: `User prompt #${messageIndex}: please do the thing and also the other thing`,
    timestamp: new Date(
      1_700_000_000_000 + messageIndex * 60_000
    ).toISOString(),
  }
}

function generateTimeline(shape: TimelineShape): {
  runs: Array<IncludesRun>
  inbox: Array<IncludesInboxMessage>
} {
  const runs: Array<IncludesRun> = []
  const inbox: Array<IncludesInboxMessage> = []
  for (let i = 1; i <= shape.exchanges; i++) {
    inbox.push(makeInbox(i))
    runs.push(makeRun(i, shape))
  }
  return { runs, inbox }
}

// ---------- Benchmark harness ----------

interface BenchResult {
  label: string
  iterations: number
  mean: number
  median: number
  p95: number
  min: number
  max: number
}

function bench(label: string, iterations: number, fn: () => void): BenchResult {
  // Warm up
  for (let i = 0; i < Math.min(20, iterations); i++) fn()

  const times: Array<number> = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  const median = times[Math.floor(times.length / 2)]!
  const p95 = times[Math.floor(times.length * 0.95)]!
  return {
    label,
    iterations,
    mean,
    median,
    p95,
    min: times[0]!,
    max: times[times.length - 1]!,
  }
}

function formatMs(n: number): string {
  if (n < 0.001) return `${(n * 1000).toFixed(2)}µs`
  if (n < 1) return `${n.toFixed(3)}ms`
  return `${n.toFixed(2)}ms`
}

function printResult(r: BenchResult): void {
  console.log(
    `  ${r.label.padEnd(48)} ` +
      `mean=${formatMs(r.mean).padStart(9)}  ` +
      `p50=${formatMs(r.median).padStart(9)}  ` +
      `p95=${formatMs(r.p95).padStart(9)}  ` +
      `(n=${r.iterations})`
  )
}

// ---------- Scenarios ----------

console.log(
  `\n=== Scenario 1: cold buildSections at various transcript sizes ===`
)
console.log(
  `  Each "exchange" = 1 user message + 1 agent run with 3 text chunks + 1 tool call.\n`
)

const baseShape: Omit<TimelineShape, `exchanges`> = {
  textsPerResponse: 3,
  toolCallsPerResponse: 1,
}

const sizes = [10, 25, 50, 100, 200, 500, 1000]
const coldResults: Array<BenchResult> = []
for (const exchanges of sizes) {
  const { runs, inbox } = generateTimeline({ ...baseShape, exchanges })
  const iterations = exchanges <= 50 ? 5000 : exchanges <= 200 ? 2000 : 500
  const result = bench(
    `buildSections(${exchanges} exchanges)`,
    iterations,
    () => {
      buildSections(runs, inbox)
    }
  )
  coldResults.push(result)
  printResult(result)
}

console.log(
  `\n=== Scenario 2: normalizeEntityTimelineData cost (for comparison) ===`
)
console.log(
  `  Called on every render of useEntityTimeline right before buildSections.\n`
)
for (const exchanges of [50, 200, 1000]) {
  const { runs, inbox } = generateTimeline({ ...baseShape, exchanges })
  const data: EntityTimelineData = {
    runs,
    inbox,
    wakes: [],
    contextInserted: [],
    contextRemoved: [],
    entities: [],
  }
  const iterations = 5000
  const result = bench(
    `normalizeEntityTimelineData(${exchanges} exchanges)`,
    iterations,
    () => {
      normalizeEntityTimelineData(data)
    }
  )
  printResult(result)
}

console.log(
  `\n=== Scenario 3: simulated streaming (growing last run's text) ===`
)
console.log(
  `  Fixed-size transcript, mutate the trailing text delta each iteration,`
)
console.log(
  `  then call buildSections. Models what happens on each streamed token.\n`
)
for (const exchanges of [50, 200, 1000]) {
  const { runs, inbox } = generateTimeline({ ...baseShape, exchanges })
  const lastRun = runs[runs.length - 1]!
  // Make a mutable streaming text entry
  const streamingText = {
    ...lastRun.texts[lastRun.texts.length - 1]!,
    text: ``,
    status: `streaming` as const,
  }
  lastRun.texts[lastRun.texts.length - 1] = streamingText

  let tokenCount = 0
  const iterations = 2000
  const result = bench(
    `streaming tick (${exchanges} exchanges)`,
    iterations,
    () => {
      // Simulate a new streamed token arriving
      tokenCount++
      streamingText.text += ` tok${tokenCount}`
      buildSections(runs, inbox)
    }
  )
  printResult(result)
}

console.log(
  `\n=== Scenario 4: heavier per-response (more texts and tool calls) ===`
)
console.log(
  `  Simulates a reasoning-heavy run: 8 text chunks, 4 tool calls per response.\n`
)
const heavyShape: Omit<TimelineShape, `exchanges`> = {
  textsPerResponse: 8,
  toolCallsPerResponse: 4,
}
for (const exchanges of [50, 200, 500]) {
  const { runs, inbox } = generateTimeline({ ...heavyShape, exchanges })
  const iterations = exchanges <= 100 ? 2000 : 500
  const result = bench(
    `buildSections(${exchanges} heavy exchanges)`,
    iterations,
    () => {
      buildSections(runs, inbox)
    }
  )
  printResult(result)
}

// ---------- Identity-stability smoke test ----------

console.log(
  `\n=== Scenario 5: identity-stability under IVM-style row replacement ===`
)
console.log(
  `  Replaces the trailing run's reference each tick (as TanStack DB IVM does`
)
console.log(
  `  when any nested field changes). The test asserts earlier sections keep`
)
console.log(
  `  reference (===) identity — proof that React.memo would bail out on them.\n`
)

for (const exchanges of [50, 200, 1000]) {
  const { runs, inbox } = generateTimeline({ ...baseShape, exchanges })
  let previousSections = buildSections(runs, inbox)

  // Warm up
  for (let i = 0; i < 20; i++) {
    previousSections = buildSections(runs, inbox)
  }

  let preservedIdentityCount = 0
  let totalComparisons = 0
  const tickTimes: Array<number> = []
  const iterations = 500

  for (let i = 0; i < iterations; i++) {
    // IVM row replacement: clone the trailing run with an updated streaming
    // text. This changes ONLY the last run's reference — all others still
    // point at the same objects, matching what TanStack DB emits.
    const tailRun = runs[runs.length - 1]!
    const updatedTailRun: IncludesRun = {
      ...tailRun,
      texts: tailRun.texts.map((t, idx) =>
        idx === tailRun.texts.length - 1
          ? { ...t, text: `${t.text} tok${i}`, status: `streaming` as const }
          : t
      ),
    }
    const nextRuns = [...runs.slice(0, -1), updatedTailRun]

    const start = performance.now()
    const sections = buildSections(nextRuns, inbox)
    tickTimes.push(performance.now() - start)

    // Check identity preservation for all but the last section
    // (last is expected to be new because the run ref changed).
    const lastIdx = sections.length - 1
    for (let j = 0; j < lastIdx; j++) {
      totalComparisons++
      if (sections[j] === previousSections[j]) {
        preservedIdentityCount++
      }
    }
    previousSections = sections
  }

  tickTimes.sort((a, b) => a - b)
  const mean = tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length
  const p95 = tickTimes[Math.floor(tickTimes.length * 0.95)]!
  const pct =
    totalComparisons === 0
      ? 100
      : (preservedIdentityCount / totalComparisons) * 100

  console.log(
    `  ${exchanges.toString().padStart(4)} exchanges: ` +
      `mean=${formatMs(mean).padStart(9)}  p95=${formatMs(p95).padStart(9)}  ` +
      `identity preserved: ${pct.toFixed(1)}% (${preservedIdentityCount}/${totalComparisons})`
  )

  if (pct < 99) {
    console.error(
      `    ✗ expected ~100% identity preservation — cache is not working`
    )
    process.exitCode = 1
  }
}

// ---------- Summary ----------

console.log(`\n=== Verdict ===\n`)
const biggestCold = coldResults[coldResults.length - 1]!
console.log(`  Largest cold bench: ${biggestCold.label}`)
console.log(
  `    mean=${formatMs(biggestCold.mean)}  p95=${formatMs(biggestCold.p95)}`
)
console.log(
  `\n  Rule of thumb: if p95 < 1ms at realistic sizes, useMemo is not worth it.`
)
console.log(
  `  (60fps budget = 16.67ms/frame; < 1ms is noise compared to React render time.)\n`
)
