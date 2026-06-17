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
 * Tagged shape for a chat fixture — one user prompt, one streaming
 * agent response. The optional `toolCall` is rendered as a small
 * card just BEFORE the fenced code block in the response (the natural
 * rhythm reads as "agent prepares → tool call → code result"). `null`
 * means "no tool card" (some fixtures don't fire a tool call at all).
 *
 * Design rule for `agentResponseText`: the first prose paragraph is
 * always plain English (the streaming "got it" beat); the optional
 * fenced ```ts/```sh block is the only non-prose surface the
 * primitive renders specially — bullet lists / numbered lists /
 * markdown tables in the prose body would render as literal text
 * because `AppAgentResponse.renderInline()` only handles inline
 * code with single backticks. Use a fenced code block for any
 * tabular content.
 */
export interface ChatFixtureData {
  userPrompt: string
  agentResponseText: string
  toolCall: {
    name: string
    args: string
    /**
     * Optional progress ratio (0..1) at which the tool-call card
     * appears. When omitted, `AppAgentResponse` auto-fires the card
     * a small lead before the code-block reveals — set this only if
     * a fixture wants different timing (e.g. no code block, or fire
     * after the code block).
     */
    appearAt?: number
  } | null
}

/**
 * Named chat-fixture variants. Each scenario card on the /app page
 * picks one of these keys; the hero / brand-toy stage uses the
 * `default` variant. New variants land here rather than as ad-hoc
 * props at the call site, so the streaming primitive can pick up
 * the matching `agentResponseText.length` without each consumer
 * having to thread the length around.
 *
 * Locked content per scenario — these strings demonstrate the
 * scenario's narrative (locked in APP_PAGE_PLAN.md §3.5):
 *
 *   default              — generic createSession refactor (hero)
 *   github-issue         — flaky CI test investigation
 *   parallel-workers     — fan-out rename across 4 packages
 *   overnight-research   — completed nightly scan with leads
 */
export const CHAT_FIXTURES = {
  default: {
    userPrompt: `refactor packages/auth to use the new session helper, write a quick test`,
    agentResponseText: `Got it. The new \`createSession\` helper takes a JWT and returns a typed session object — I'll thread it through the four call sites in \`packages/auth\` and add a focused test.

Here's the helper applied at the entry point:

\`\`\`ts
import { createSession } from '@electric/auth'

export async function authenticate(jwt: string) {
  const session = await createSession(jwt)
  return session.user
}
\`\`\`

I've also drafted a \`vitest\` case that covers the happy path and a malformed-JWT rejection.`,
    toolCall: {
      name: `read_file`,
      args: `packages/auth/src/index.ts`,
    },
  },

  'github-issue': {
    userPrompt: `Investigate flaky auth test #1724 — fails ~30% of the time on CI, passes locally. Started after #1683 landed.`,
    agentResponseText: `On it. Walking #1683's diff against the failing test traces — the flake started right after the JWT \`exp\` comparison switched to \`Date.now()\`, which is sensitive to clock skew between the test runner and the JWT issuer.

Here's the line in question:

\`\`\`ts
// packages/auth/src/jwt.ts:42
if (Date.now() > token.exp * 1000) {
  throw new ExpiredTokenError()
}
\`\`\`

Drafting a fix: inject a deterministic \`Clock\` in the test fixture and add a 5-second skew tolerance for prod. PR incoming.`,
    toolCall: {
      name: `read_file`,
      args: `packages/auth/src/jwt.ts`,
    },
  },

  'parallel-workers': {
    userPrompt: `rename \`getCurrentUserId\` to \`getActiveUserId\` across all four packages — update call sites + tests`,
    agentResponseText: `On it. Spawning a worker per package so each one runs in parallel — each worker sweeps its call sites and updates tests independently, and I'll review the diffs together once they report back.

Here's the worker plan:

\`\`\`sh
typescript-client   →  4 call sites
agents-runtime      →  8 call sites
agents-server       → 12 call sites
agents-server-ui    →  3 call sites
\`\`\`

Fork the one that takes a wrong turn from its run if you spot something off — the tile workspace will tile parent + workers side-by-side.`,
    toolCall: {
      name: `spawn_worker`,
      args: `parallel-rename · 4 packages`,
    },
  },

  'overnight-research': {
    userPrompt: `Nightly scan — HN, arxiv-cs and the listed dev blogs (last 24h) for posts about local-first sync engines or agent runtimes. Top 5, with sources.`,
    agentResponseText: `Done — scanned 412 sources overnight. Top 5 leads, ranked by signal:

\`\`\`sh
PowerSync v0.5 GA          bidirectional sync, 10× write throughput
Convex 'reactor' pattern   long-lived background agents in actions
Yjs + Postgres adapter     HN benchmark thread, 240+ comments
Anthropic SDK 0.7          new tool-call streaming API
Bonsai (arxiv 2510.18482)  ahead-of-time graph compilation
\`\`\`

Want me to fork one into a fresh session and dig deeper, or hand the most promising lead off to a separate agent?`,
    toolCall: {
      name: `fetch_url`,
      args: `412 sources · 8h 14m runtime`,
    },
  },
} as const satisfies Record<string, ChatFixtureData>

export type ChatFixtureKey = keyof typeof CHAT_FIXTURES

/**
 * One bubble, one Horton response — kept as a back-compat alias
 * pointing at the `default` variant of CHAT_FIXTURES so existing
 * imports (the hero scene, the toys) keep working unchanged.
 */
export const CHAT_FIXTURE: ChatFixtureData = CHAT_FIXTURES.default

/** Length of the default streaming text — back-compat alias.
 * Streaming primitives now compute the length from the active
 * fixture themselves; this constant remains for any consumers that
 * want the default at module-eval time. */
export const CHAT_FIXTURE_LENGTH = CHAT_FIXTURE.agentResponseText.length

// ─────────────────────────── State inspector ───────────────────────────

/**
 * One Type row in the left "Types" panel of the state inspector.
 * The real product groups records by type; the marketing mockup
 * follows the same shape with a fixed label + row count + a
 * selected flag on the active type.
 */
export interface MockStateType {
  name: string
  count: number
  selected?: boolean
}

/**
 * One Record row in the right "Records" panel of the state inspector.
 * Mirrors the real columns: key (mono record id), from (mono
 * principal url), payload (preview of the stored value).
 */
export interface MockStateRecord {
  key: string
  from: string
  payload: string
}

/**
 * One Event row in the bottom "Events" panel.
 *
 * Each event represents a streamdb insert (`INS`) — the real product
 * also surfaces updates and deletes, but the steady-state marketing
 * fixture only paints inserts since that's what dominates a live
 * agent run. Numbered with a 2-digit zero-padded index in the UI.
 */
export interface MockStateEvent {
  /** 1-based index, displayed in mono on the left edge. */
  index: number
  /** The event verb — only `INS` for the marketing fixture. */
  kind: `INS` | `UPD` | `DEL`
  /** Type:key dotted summary, e.g. `inbox:msg-in-1780…`. */
  summary: string
}

/**
 * Tagged shape for a state-explorer fixture — the four pieces of
 * fake data the inspector needs to render. The matching
 * `pulseOrder` drives the deterministic Events-panel pulse: each
 * tick the cursor advances through the order list and the
 * corresponding `events[i]` row briefly lifts (CSS keyframe).
 */
export interface StateFixtureData {
  types: readonly MockStateType[]
  records: readonly MockStateRecord[]
  events: readonly MockStateEvent[]
  pulseOrder: readonly number[]
}

/**
 * Named state-fixture variants. Same pattern as `CHAT_FIXTURES` —
 * each scenario picks a key, the hero uses `default`. New variants
 * land here rather than at the call site so the inspector primitive
 * can pick up the matching pulse-order list internally.
 *
 *   default     — Horton run-loop (entity_created → run → text_delta)
 *   summarizer  — custom SDK entity caught mid-failure (chunk 9
 *                 errored, summaries panel selected)
 */
export const STATE_FIXTURES = {
  default: {
    types: [
      { name: `entity_created`, count: 1 },
      { name: `inbox`, count: 1 },
      { name: `run`, count: 1 },
      { name: `step`, count: 1 },
      { name: `text`, count: 1 },
      { name: `text_delta`, count: 6, selected: true },
      { name: `tags`, count: 1 },
    ],
    records: [
      {
        key: `msg-in-1780491582518-283dha`,
        from: `/principal/system%3Adev-local`,
        payload: `Test`,
      },
    ],
    events: [
      { index: 1, kind: `INS`, summary: `entity_created:entity-created` },
      { index: 2, kind: `INS`, summary: `inbox:msg-in-1780491582518-283dha` },
      { index: 3, kind: `INS`, summary: `run:run-0` },
      { index: 4, kind: `INS`, summary: `step:step-0` },
      { index: 5, kind: `INS`, summary: `text:msg-0` },
      { index: 6, kind: `INS`, summary: `text_delta:msg-0:0` },
      { index: 7, kind: `INS`, summary: `tags:title` },
      { index: 8, kind: `INS`, summary: `text_delta:msg-0:1` },
      { index: 9, kind: `INS`, summary: `text_delta:msg-0:2` },
      { index: 10, kind: `INS`, summary: `text_delta:msg-0:3` },
      { index: 11, kind: `INS`, summary: `text_delta:msg-0:4` },
      { index: 12, kind: `INS`, summary: `text_delta:msg-0:5` },
      { index: 13, kind: `INS`, summary: `text:msg-0:end` },
      { index: 14, kind: `INS`, summary: `step:step-0:end` },
      { index: 15, kind: `INS`, summary: `run:run-0:end` },
    ],
    /* Walks through the trailing text_delta inserts (6→12) into the
       step / run end events — matches the cadence of a real run
       wrapping up. */
    pulseOrder: [9, 10, 11, 5, 6, 7, 8, 12, 13],
  },

  summarizer: {
    /* Custom `summarizer` entity from APP_PAGE_PLAN.md §3.5
       scenario 3: ingests a doc, splits into chunks, summarises
       each, then merges. Caught mid-failure — chunk 9 contained a
       single 32k token that broke the per-chunk summariser, so the
       `summaries` count is 11 not 12 and `merged` never reached. */
    types: [
      { name: `inputs`, count: 3 },
      { name: `chunks`, count: 12 },
      { name: `summaries`, count: 11, selected: true },
      { name: `merged`, count: 0 },
      { name: `errors`, count: 1 },
      { name: `tags`, count: 1 },
    ],
    records: [
      {
        key: `sum-9-malformed`,
        from: `/principal/system%3Adev-local`,
        payload: `…failed: chunk 9 was a single 32k token`,
      },
    ],
    events: [
      { index: 1, kind: `INS`, summary: `inputs:doc-1` },
      { index: 2, kind: `INS`, summary: `chunks:chunk-0` },
      { index: 3, kind: `INS`, summary: `chunks:chunk-1` },
      { index: 4, kind: `INS`, summary: `summaries:sum-0` },
      { index: 5, kind: `INS`, summary: `chunks:chunk-2` },
      { index: 6, kind: `INS`, summary: `summaries:sum-1` },
      { index: 7, kind: `INS`, summary: `chunks:chunk-3` },
      { index: 8, kind: `INS`, summary: `summaries:sum-2` },
      { index: 9, kind: `INS`, summary: `chunks:chunk-9` },
      { index: 10, kind: `INS`, summary: `summaries:sum-7` },
      { index: 11, kind: `INS`, summary: `chunks:chunk-10` },
      { index: 12, kind: `INS`, summary: `summaries:sum-8` },
      { index: 13, kind: `INS`, summary: `chunks:chunk-11` },
      { index: 14, kind: `INS`, summary: `summaries:sum-10` },
      { index: 15, kind: `INS`, summary: `errors:err-9-malformed` },
    ],
    /* Walks through the late-flow chunks + the trailing error so
       the eye lands on the failure mode without us having to
       paint it red. */
    pulseOrder: [9, 10, 11, 12, 13, 14, 15, 8, 7],
  },
} as const satisfies Record<string, StateFixtureData>

export type StateFixtureKey = keyof typeof STATE_FIXTURES

/* ───────── Back-compat exports — point at the `default` variant
   of STATE_FIXTURES so existing imports keep working. ───────── */

/** Default Types panel fixture — modelled on the real-app screenshot. */
export const STATE_TYPES_FIXTURE = STATE_FIXTURES.default.types

export const STATE_RECORDS_FIXTURE = STATE_FIXTURES.default.records

export const STATE_EVENTS_FIXTURE = STATE_FIXTURES.default.events

/**
 * Deterministic pulse cursor for the default Events panel.
 * Inspector consumers now resolve the active fixture's `pulseOrder`
 * internally via `STATE_FIXTURES[key].pulseOrder`; this constant
 * remains for any callers that want the default at module-eval
 * time.
 */
export const STATE_EVENT_PULSE_ORDER = STATE_FIXTURES.default.pulseOrder

// ─────────────────────────── Legacy state table ───────────────────────────

/* The previous flat-table fixtures (`STATE_TABLE_FIXTURE`,
   `STATE_PULSE_ORDER`, `MockStateRow`) were removed alongside the
   `AppStateTable` / `AppStateRow` primitives during the post-review
   correction pass — the new `AppStateInspector` covers the same
   ground in a 3-panel layout that matches the real product. See
   §0 of APP_DESKTOP_MOCKUP_PLAN.md. */
