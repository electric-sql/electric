import { compareTimelineOrders } from './entity-timeline'
import type {
  EntityTimelineContentItem,
  EntityTimelineSection,
  IncludesInboxMessage,
  IncludesRun,
} from './entity-timeline'

type UserMessageSection = Extract<
  EntityTimelineSection,
  { kind: `user_message` }
>
type AgentResponseSection = Extract<
  EntityTimelineSection,
  { kind: `agent_response` }
>
export interface EntityTimelineEntry {
  key: string
  section: EntityTimelineSection
  responseTimestamp: number | null
}

function payloadToText(payload: unknown): string {
  if (typeof payload === `string`) return payload
  if (payload == null) return ``
  if (typeof payload === `object`) {
    const text = (payload as Record<string, unknown>).text
    return typeof text === `string` ? text : JSON.stringify(payload)
  }
  return String(payload)
}

function parseToolArgs(argsRaw: unknown): Record<string, unknown> {
  if (
    argsRaw !== null &&
    typeof argsRaw === `object` &&
    !Array.isArray(argsRaw)
  ) {
    return argsRaw as Record<string, unknown>
  }
  if (typeof argsRaw === `string`) {
    try {
      const parsed = JSON.parse(argsRaw)
      return typeof parsed === `object` && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return { _raw: argsRaw, _parseError: `Invalid JSON tool args` }
    }
  }
  return {}
}

// Identity-stable section caches keyed on a row's stable identifier
// (`run.key` / `msg.key`) plus a content fingerprint.
//
// **Why not WeakMap on row references?** The runtime's includes-build
// pipeline (`buildIncludesRuns` → `normalizeTimelineRun`) rebuilds every
// `IncludesRun` and `IncludesInboxMessage` on every emit — each layer
// does `.map(row => ({...row, ...}))`. So the row reference observed by
// React on tick N is never the reference observed on tick N+1, even
// when nothing about the row changed. A WeakMap keyed on the row would
// miss every render, defeating the cache and forcing every `<AgentResponse>`
// in the timeline to re-render on every streamed chunk.
//
// **Key + fingerprint instead.** Cache on `row.key`, then verify a
// cheap content fingerprint. Unchanged rows hit (because key + fingerprint
// match) and return the same `EntityTimelineSection` reference, so
// `React.memo<AgentResponse>` and `React.memo<UserMessage>` bail out on
// every settled row during streaming. Changed rows miss, rebuild, and
// overwrite. The fingerprint also defends against `run.key` collisions
// between separate entity timelines that share the module-level cache —
// different content fingerprints invalidate each other rather than
// serving stale data.
//
// **Streaming runs are cached too** (was previously `isTerminal`-only).
// The fingerprint catches text growth and status flips, so caching is
// safe even mid-stream — and it's what makes settled rows actually skip
// re-renders while a single tail run is generating tokens.
//
// **Bounded by `pruneSectionCaches` at the end of each
// `buildTimelineEntries` call** so navigating between entities doesn't
// grow the cache without limit. Entries whose keys don't appear in the
// current build are dropped.
//
// The user cache still has two slots because `isInitial` depends on the
// message's position in the timeline, not on the row alone — if an
// earlier message is ever prepended, the previously-first message must
// produce a new, non-initial section. Slot types are branded on the
// `isInitial` literal so the compiler enforces the slot never holds the
// wrong polarity.
type InitialUserSection = UserMessageSection & { isInitial: true }
type NonInitialUserSection = UserMessageSection & { isInitial: false }
type UserSectionCacheEntry = {
  fingerprint: string
  initial?: InitialUserSection
  nonInitial?: NonInitialUserSection
}
let userSectionCache = new Map<string, UserSectionCacheEntry>()
let agentSectionCache = new Map<
  string,
  { fingerprint: string; section: AgentResponseSection }
>()

/**
 * Test-only hook: drops both section caches so tests that share row literals
 * across `describe` blocks don't see stale identity from a previous test.
 * Production code should never call this.
 */
export function __resetSectionCachesForTesting(): void {
  userSectionCache = new Map()
  agentSectionCache = new Map()
}

/**
 * Cheap content fingerprint of an `IncludesRun`. Captures every field
 * that influences the rendered section without paying for a full
 * `JSON.stringify` of potentially-large tool-call args / results.
 *
 * - `run.status` — terminal flips finalize the section (`done: true`).
 * - `run.errors.length` — error appends populate `section.error`.
 * - per-text `key`, `text.length`, `status` — texts grow monotonically
 *   during streaming, so length is a reliable change detector.
 * - per-toolCall `key`, `status`, plus a length / key-count sniff of
 *   `args` and `result`. Status flips capture most transitions in
 *   production (args finalize at `args_complete`, results at
 *   `completed`/`failed`), but the length sniff defends against
 *   key-collision cases where two unrelated runs share a `key` but
 *   have different payloads — without it, navigating away from one
 *   timeline and back into another with overlapping run keys could
 *   serve a stale section.
 *
 * Stable order: walks `run.texts` and `run.toolCalls` in their already-
 * sorted-by-order arrays, so the fingerprint string is deterministic.
 */
function fingerprintRun(run: IncludesRun): string {
  let fp = `${run.status}|e:${run.errors.length}|t:${run.texts.length}`
  for (const t of run.texts) {
    fp += `:${t.key}.${t.text.length}.${t.status}`
  }
  fp += `|tc:${run.toolCalls.length}`
  for (const tc of run.toolCalls) {
    fp += `:${tc.key}.${tc.status}${payloadSniff(`a`, tc.args)}${payloadSniff(`r`, tc.result)}`
  }
  return fp
}

/**
 * Cheap fixed-cost content sniff for a tool-call arg / result value.
 * Encodes a one-character type tag plus a size hint:
 *
 *   - `0` — null / undefined
 *   - `s<n>` — string of length n
 *   - `o<n>` — plain object with n own enumerable keys
 *   - `n<v>` — number / boolean / bigint, encoded as its `String()`
 *   - `x` — anything else (function / symbol / etc.; should never
 *     happen for real tool data)
 *
 * Designed so that the typical tool-call argument shapes (string
 * payloads, small object literals) produce distinct fingerprints
 * without ever scanning recursively into nested structures.
 */
function payloadSniff(prefix: `a` | `r`, value: unknown): string {
  if (value == null) return `.${prefix}0`
  if (typeof value === `string`) return `.${prefix}s${value.length}`
  if (typeof value === `object`) {
    return `.${prefix}o${Object.keys(value).length}`
  }
  if (
    typeof value === `number` ||
    typeof value === `boolean` ||
    typeof value === `bigint`
  ) {
    return `.${prefix}n${String(value)}`
  }
  return `.${prefix}x`
}

/**
 * Bounds both module-level caches by dropping entries whose keys aren't
 * present in the latest `buildTimelineEntries` call. Without this the
 * cache would accumulate every run / message ever observed across every
 * entity the user has navigated through. The size check skips the
 * O(cache + rows) walk in the common case where the cache is already
 * the right size or smaller.
 */
function pruneSectionCaches(
  runs: ReadonlyArray<IncludesRun>,
  inbox: ReadonlyArray<IncludesInboxMessage>
): void {
  if (agentSectionCache.size > runs.length) {
    const live = new Set(runs.map((r) => r.key))
    for (const k of agentSectionCache.keys()) {
      if (!live.has(k)) agentSectionCache.delete(k)
    }
  }
  if (userSectionCache.size > inbox.length) {
    const live = new Set(inbox.map((m) => m.key))
    for (const k of userSectionCache.keys()) {
      if (!live.has(k)) userSectionCache.delete(k)
    }
  }
}

/**
 * Content fingerprint for an inbox message. Inbox messages are
 * immutable in production (same `key` ⇒ same content), so this is
 * essentially a no-op there. It defends against (1) cross-entity
 * `msg.key` collisions in the module-level cache (each entity numbers
 * its inbox from 0), and (2) test patterns that reuse a `key` with
 * different payloads across `it()` blocks.
 *
 * `payloadToText` is duplicated work with `buildUserSection`, but the
 * cost is bounded by message size and only avoided on cache hits —
 * which is the common case during streaming where the inbox doesn't
 * change at all.
 */
function fingerprintMessage(msg: IncludesInboxMessage): string {
  return `${msg.from}|${msg.timestamp}|${payloadToText(msg.payload)}`
}

function buildUserSection(
  msg: IncludesInboxMessage,
  isInitial: boolean
): UserMessageSection {
  const fingerprint = fingerprintMessage(msg)
  let entry = userSectionCache.get(msg.key)
  // Stale entry (fingerprint mismatch) ⇒ blow away both slots so we
  // don't return a section built from a previous payload that happened
  // to share a key.
  if (!entry || entry.fingerprint !== fingerprint) {
    entry = { fingerprint }
    userSectionCache.set(msg.key, entry)
  }

  const timestamp = Date.parse(msg.timestamp)
  const common = {
    kind: `user_message` as const,
    from: msg.from,
    text: payloadToText(msg.payload),
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  }

  // The two slots persist because `isInitial` is a *positional*
  // property — if an earlier message is later prepended, the
  // previously-first message must produce a new, non-initial section
  // (covered by the "re-derives a cached user message…" test).
  if (isInitial) {
    if (entry.initial) return entry.initial
    const section: InitialUserSection = { ...common, isInitial: true }
    entry.initial = section
    return section
  }
  if (entry.nonInitial) return entry.nonInitial
  const section: NonInitialUserSection = { ...common, isInitial: false }
  entry.nonInitial = section
  return section
}

function buildAgentSection(run: IncludesRun): AgentResponseSection {
  const fingerprint = fingerprintRun(run)
  const cached = agentSectionCache.get(run.key)
  if (cached && cached.fingerprint === fingerprint) {
    return cached.section
  }

  // Interleave texts and tool calls by their timeline order.
  type RunItem =
    | { kind: `text`; data: IncludesRun[`texts`][number] }
    | { kind: `tool_call`; data: IncludesRun[`toolCalls`][number] }

  const runItems: Array<RunItem> = [
    ...run.texts.map((data): RunItem => ({ kind: `text`, data })),
    ...run.toolCalls.map((data): RunItem => ({ kind: `tool_call`, data })),
  ]
  runItems.sort((a, b) => compareTimelineOrders(a.data.order, b.data.order))

  const contentItems: Array<EntityTimelineContentItem> = []
  for (const ri of runItems) {
    if (ri.kind === `text`) {
      if (!ri.data.text) continue
      contentItems.push({ kind: `text`, text: ri.data.text })
      continue
    }
    const tc = ri.data
    contentItems.push({
      kind: `tool_call`,
      toolCallId: tc.key,
      toolName: tc.tool_name,
      args: parseToolArgs(tc.args),
      status: tc.status,
      isError: tc.status === `failed`,
      ...(tc.result != null && {
        result:
          typeof tc.result === `string` ? tc.result : JSON.stringify(tc.result),
      }),
    })
  }

  let errorText: string | undefined
  if (run.errors.length > 0) {
    errorText = run.errors.map((e) => e.message).join(`; `)
  } else if (run.status === `failed`) {
    errorText = `Run failed`
  }

  const section: AgentResponseSection = {
    kind: `agent_response`,
    items: contentItems,
    ...(run.status === `completed` && { done: true as const }),
    ...(errorText && { error: errorText }),
  }
  // Always cache (terminal or in-flight). Fingerprint check above
  // guarantees we never serve a stale streaming section — text growth
  // and status flips both invalidate the cache entry — so caching mid-
  // stream is safe and lets settled rows above the streaming tail bail
  // out of re-rendering on every chunk.
  agentSectionCache.set(run.key, { fingerprint, section })
  return section
}

export function buildSections(
  runs: Array<IncludesRun>,
  inbox: Array<IncludesInboxMessage>
): Array<EntityTimelineSection> {
  return buildTimelineEntries(runs, inbox).map((entry) => entry.section)
}

export function buildTimelineEntries(
  runs: Array<IncludesRun>,
  inbox: Array<IncludesInboxMessage>
): Array<EntityTimelineEntry> {
  type TimelineItem =
    | { kind: `inbox`; data: IncludesInboxMessage }
    | { kind: `run`; data: IncludesRun }

  const items: Array<TimelineItem> = [
    ...inbox.map((data): TimelineItem => ({ kind: `inbox`, data })),
    ...runs.map((data): TimelineItem => ({ kind: `run`, data })),
  ]
  items.sort((a, b) => compareTimelineOrders(a.data.order, b.data.order))

  let userMessageCount = 0
  let lastUserTimestamp: number | null = null
  const entries: Array<EntityTimelineEntry> = []

  for (const item of items) {
    if (item.kind === `inbox`) {
      const section = buildUserSection(item.data, userMessageCount === 0)
      lastUserTimestamp = section.timestamp
      entries.push({
        key: `inbox:${item.data.key}`,
        section,
        responseTimestamp: null,
      })
      userMessageCount++
    } else {
      entries.push({
        key: `run:${item.data.key}`,
        section: buildAgentSection(item.data),
        responseTimestamp: lastUserTimestamp,
      })
    }
  }

  // Drop cache entries for runs / messages that are no longer in the
  // current timeline. Bounds memory across entity navigation so the
  // module-level caches don't accumulate every row ever observed.
  pruneSectionCaches(runs, inbox)

  return entries
}
