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

/** Default Types panel fixture — modelled on the real-app screenshot
 * (entity_created / inbox / run / step / text / text_delta / tags),
 * with `text_delta` selected as the type whose Records the right
 * panel renders. */
export const STATE_TYPES_FIXTURE: readonly MockStateType[] = [
  { name: `entity_created`, count: 1 },
  { name: `inbox`, count: 1 },
  { name: `run`, count: 1 },
  { name: `step`, count: 1 },
  { name: `text`, count: 1 },
  { name: `text_delta`, count: 6, selected: true },
  { name: `tags`, count: 1 },
]

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

export const STATE_RECORDS_FIXTURE: readonly MockStateRecord[] = [
  {
    key: `msg-in-1780491582518-283dha`,
    from: `/principal/system%3Adev-local`,
    payload: `Test`,
  },
]

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

export const STATE_EVENTS_FIXTURE: readonly MockStateEvent[] = [
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
]

/**
 * Deterministic pulse cursor for the Events panel — same convention
 * as `STATE_PULSE_ORDER` below (kept for the legacy AppStateTable
 * primitive while it's still around). Index list points into
 * `STATE_EVENTS_FIXTURE`. Designed to walk the bottom of the list
 * (rows 12–15) in order, then loop back — matches the cadence of a
 * real run wrapping up, with text_delta inserts trailing into
 * step / run end events. */
export const STATE_EVENT_PULSE_ORDER: readonly number[] = [
  9, // text_delta:msg-0:2
  10, // text_delta:msg-0:3
  11, // text_delta:msg-0:4
  12, // text_delta:msg-0:5
  6, // text_delta:msg-0:0
  7, // tags:title
  8, // text_delta:msg-0:1
  13, // text:msg-0:end
  14, // step:step-0:end
]

// ─────────────────────────── Legacy state table ───────────────────────────

/* The previous flat-table fixtures (`STATE_TABLE_FIXTURE`,
   `STATE_PULSE_ORDER`, `MockStateRow`) were removed alongside the
   `AppStateTable` / `AppStateRow` primitives during the post-review
   correction pass — the new `AppStateInspector` covers the same
   ground in a 3-panel layout that matches the real product. See
   §0 of APP_DESKTOP_MOCKUP_PLAN.md. */
