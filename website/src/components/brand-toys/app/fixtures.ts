/* App mockup — fixtures.
   ─────────────────────────────────────────────────────────────────
   Single source of truth for the fake content the app mockups
   render. Hardcoded constants — no live data, no Electric, no
   `ElectricAgentsProvider`. The mockups are marketing visuals; the
   only "data" they need is whatever feeds a believable still / loop.

   Three buckets:

     1. Sidebar fixtures — entity tree (status + type + display name +
        depth + child count) for the desktop-window left rail.
     2. Chat fixture — one user prompt, one Horton response (paragraph
        + fenced code block + tool-call pill). The streaming-typewriter
        animation walks `responseText` character by character.
     3. State-table fixture — rows for the state-explorer right tile,
        plus the deterministic pulse cursor list (which row indices
        light up, in what order — see APP_DESKTOP_MOCKUP_PLAN.md §7
        animation primitives).

   Loose typing — these are display-only fixtures, not domain models.
   We deliberately do NOT import `ElectricEntity` or the real
   types from `agents-server-ui`; the website doesn't depend on that
   package and the visual fixtures only need a flat shape. If a
   primitive needs more shape than this provides, it should narrow
   the additional fields here rather than reach into the real
   types — the goal is one fixture file, not two. */

// ─────────────────────────── Sidebar ───────────────────────────

/**
 * Visible status options on a sidebar row. Mirrors the status set
 * the live `<StatusDot>` accepts, minus the values the marketing
 * mockup never needs to depict (e.g. `killed`).
 */
export type MockEntityStatus =
  | `idle`
  | `running`
  | `streaming`
  | `spawning`
  | `paused`
  | `stopped`

export interface MockSidebarRow {
  /** Entity URL — `/horton/abc123` style. Used as a stable key + display id. */
  url: string
  /** Type chip rendered to the right of the title (`horton`, `worker`, …). */
  type: string
  /** Display title — what the row shows. */
  title: string
  /** Status dot colour. */
  status: MockEntityStatus
  /** Tree indent depth, 0-based. */
  depth: number
  /** Subtree child count. > 0 enables the +N badge and chevron affordance. */
  childCount: number
  /** True if subtree is currently expanded (children visible below). */
  expanded?: boolean
  /** True if the row is the current selection. */
  selected?: boolean
}

/** Default fixture sidebar tree.
 *
 * Shaped to read like a believable workday: one Horton "/code-refactor"
 * session at the top, currently selected and streaming a response;
 * three pinned/recent sessions below it; an expanded fork-and-workers
 * subtree mid-list (so the eye sees the indented children and reads
 * "this app has a tree, not a flat list"); and a couple of finished
 * runs at the bottom rendered in the muted "stopped" tone. */
export const SIDEBAR_FIXTURE: readonly MockSidebarRow[] = [
  {
    url: `/horton/code-refactor`,
    type: `horton`,
    title: `Refactor auth helpers`,
    status: `streaming`,
    depth: 0,
    childCount: 0,
    selected: true,
  },
  {
    url: `/horton/api-tests`,
    type: `horton`,
    title: `Write tests for API client`,
    status: `idle`,
    depth: 0,
    childCount: 0,
  },
  {
    url: `/horton/parallel-rename`,
    type: `horton`,
    title: `Rename across packages`,
    status: `running`,
    depth: 0,
    childCount: 4,
    expanded: true,
  },
  {
    url: `/worker/parallel-rename/typescript-client`,
    type: `worker`,
    title: `typescript-client`,
    status: `running`,
    depth: 1,
    childCount: 0,
  },
  {
    url: `/worker/parallel-rename/agents-runtime`,
    type: `worker`,
    title: `agents-runtime`,
    status: `streaming`,
    depth: 1,
    childCount: 0,
  },
  {
    url: `/worker/parallel-rename/agents-server`,
    type: `worker`,
    title: `agents-server`,
    status: `paused`,
    depth: 1,
    childCount: 0,
  },
  {
    url: `/worker/parallel-rename/agents-server-ui`,
    type: `worker`,
    title: `agents-server-ui`,
    status: `idle`,
    depth: 1,
    childCount: 0,
  },
  {
    url: `/horton/bug-bisect`,
    type: `horton`,
    title: `Bisect ws regression`,
    status: `idle`,
    depth: 0,
    childCount: 2,
  },
  {
    url: `/research/launch-tweet`,
    type: `research`,
    title: `Draft launch tweet`,
    status: `stopped`,
    depth: 0,
    childCount: 0,
  },
  {
    url: `/horton/migration`,
    type: `horton`,
    title: `Postgres migration plan`,
    status: `stopped`,
    depth: 0,
    childCount: 0,
  },
]

// ─────────────────────────── Chat ───────────────────────────

/**
 * One bubble, one Horton response. The user prompt is static; the
 * response is the string the streaming-typewriter walks through.
 *
 * The response intentionally contains:
 *
 *   - One short opening paragraph ("Got it — here's …").
 *   - One fenced TypeScript code block (3-4 lines, hand-styled, NOT
 *     run through Shiki).
 *   - One closing sentence after the code block.
 *   - One tool-call pill rendered as a bordered chip — the typewriter
 *     "completes" the tool call when it crosses the chip boundary.
 *
 * Together that's enough surface to read as "a real coding-agent
 * talking" without us having to bundle a markdown renderer.
 */
export const CHAT_FIXTURE = {
  userPrompt: `refactor packages/auth to use the new session helper, write a quick test`,
  agentResponseText:
    // First paragraph — sets up the change.
    `Got it. The new \`createSession\` helper takes a JWT and returns a typed session object — I'll thread it through the four call sites in \`packages/auth\` and add a focused test.

Here's the helper applied at the entry point:

\`\`\`ts
import { createSession } from '@electric/auth'

export async function authenticate(jwt: string) {
  const session = await createSession(jwt)
  return session.user
}
\`\`\`

I've also drafted a \`vitest\` case that covers the happy path and a malformed-JWT rejection.`,
  /**
   * Optional tool-call shown beside the streaming response. The
   * mockup paints this as a small bordered "ran tool" pill that
   * appears when the typewriter passes the marker progress (~0.55).
   */
  toolCall: {
    name: `read_file`,
    args: `packages/auth/src/index.ts`,
    /** Progress ratio (0..1) at which the tool-call pill appears. */
    appearAt: 0.55,
  },
} as const

/** Length of the streaming text — used by the typewriter to convert
 * a chars-per-second target into a per-frame progress increment. */
export const CHAT_FIXTURE_LENGTH = CHAT_FIXTURE.agentResponseText.length

// ─────────────────────────── State table ───────────────────────────

/**
 * One row in the state-explorer table. The real product has more
 * shape than this (key path, value preview, source entity, last
 * updated, etc.), but the marketing mockup only needs enough to
 * render a believable table grid with the right hue per row class.
 */
export interface MockStateRow {
  /** State key — left column. Mono font. */
  key: string
  /** Value preview — middle column. Truncated with ellipsis. */
  value: string
  /** Source entity url — right column. Mono, muted. */
  source: string
  /** Hue used for the row's left border + key text. */
  kind: `message` | `tool-call` | `tool-result` | `event` | `error`
}

export const STATE_TABLE_FIXTURE: readonly MockStateRow[] = [
  {
    key: `inbox.next`,
    value: `{ "type": "wake", "from": "/cron" }`,
    source: `/horton/code-refactor`,
    kind: `message`,
  },
  {
    key: `runs[12].status`,
    value: `"streaming"`,
    source: `/horton/code-refactor`,
    kind: `event`,
  },
  {
    key: `tools.read_file`,
    value: `"packages/auth/src/index.ts"`,
    source: `/horton/code-refactor`,
    kind: `tool-call`,
  },
  {
    key: `tools.read_file.result`,
    value: `"export function authenticate(jwt …"`,
    source: `/horton/code-refactor`,
    kind: `tool-result`,
  },
  {
    key: `manifest.skills`,
    value: `["code-refactor", "vitest", "claude-4.6-sonnet"]`,
    source: `/horton/code-refactor`,
    kind: `event`,
  },
  {
    key: `runs[12].messages.last`,
    value: `"Here's the helper applied at the entry point …"`,
    source: `/horton/code-refactor`,
    kind: `message`,
  },
  {
    key: `workers.spawned`,
    value: `["typescript-client", "agents-runtime"]`,
    source: `/horton/parallel-rename`,
    kind: `event`,
  },
  {
    key: `errors.last`,
    value: `null`,
    source: `/horton/code-refactor`,
    kind: `error`,
  },
  {
    key: `tools.run_bash`,
    value: `"pnpm vitest run packages/auth"`,
    source: `/horton/code-refactor`,
    kind: `tool-call`,
  },
  {
    key: `tools.run_bash.result`,
    value: `"  Tests  3 passed (3)"`,
    source: `/horton/code-refactor`,
    kind: `tool-result`,
  },
]

/**
 * Deterministic pulse order for the state-explorer animation.
 *
 * Indexes into `STATE_TABLE_FIXTURE`. Every `1 / pulseRate` seconds
 * the cursor advances one step and the row at that index lights up
 * for ~600 ms (CSS keyframe). Wraps to the start of the list — the
 * same recording every cycle.
 *
 * Pattern logic: alternate "obvious activity" rows (messages, events,
 * tool calls) with one quiet row (errors.last) so the table reads as
 * mostly active with occasional idle frames — same rhythm a real
 * agent run produces.
 */
export const STATE_PULSE_ORDER: readonly number[] = [
  0, // inbox.next            (message)
  2, // tools.read_file       (tool-call)
  3, // tools.read_file.result (tool-result)
  5, // runs[12].messages.last (message)
  1, // runs[12].status       (event)
  8, // tools.run_bash        (tool-call)
  9, // tools.run_bash.result (tool-result)
  6, // workers.spawned       (event)
  7, // errors.last           (idle dim)
]
