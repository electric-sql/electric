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

// Identity-stable section caches, keyed on the row objects from TanStack DB.
// When IVM preserves a row's reference across reactive updates, the cache
// returns the same section object, letting React.memo bail out on unchanged
// timeline entries. Entries are GC'd with their source rows via WeakMap, so
// no explicit eviction is needed in production. The user cache has two slots
// because `isInitial` depends on the message's position, not just the row —
// if an earlier message is ever inserted, the previously-first message must
// produce a new, non-initial section.
//
// Agent runs are only cached once `status` is terminal. While a run is
// in-flight, IVM may preserve the outer run reference even as nested texts
// and tool-call arrays mutate, so caching during streaming would freeze the
// section at its first observed state. Terminal runs are immutable, so
// caching them is safe and still gives the full perf win for long transcripts
// (everything but the streaming tail).
// Slot types branded on the `isInitial` literal so the compiler enforces that
// the `initial` slot never holds a section with `isInitial: false` (or vice
// versa). Without this, a future refactor that swapped the slot key could
// silently return a section with the wrong `isInitial` value.
type InitialUserSection = UserMessageSection & { isInitial: true }
type NonInitialUserSection = UserMessageSection & { isInitial: false }
type UserSectionSlots = {
  initial?: InitialUserSection
  nonInitial?: NonInitialUserSection
}
let userSectionCache = new WeakMap<IncludesInboxMessage, UserSectionSlots>()
let agentSectionCache = new WeakMap<IncludesRun, AgentResponseSection>()

/**
 * Test-only hook: drops both section caches so tests that share row literals
 * across `describe` blocks don't see stale identity from a previous test.
 * Production code should never call this.
 */
export function __resetSectionCachesForTesting(): void {
  userSectionCache = new WeakMap()
  agentSectionCache = new WeakMap()
}

function buildUserSection(
  msg: IncludesInboxMessage,
  isInitial: boolean
): UserMessageSection {
  let slots = userSectionCache.get(msg)
  if (!slots) {
    slots = {}
    userSectionCache.set(msg, slots)
  }

  const timestamp = Date.parse(msg.timestamp)
  const common = {
    kind: `user_message` as const,
    from: msg.from,
    text: payloadToText(msg.payload),
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  }

  if (isInitial) {
    if (slots.initial) return slots.initial
    const section: InitialUserSection = { ...common, isInitial: true }
    slots.initial = section
    return section
  }
  if (slots.nonInitial) return slots.nonInitial
  const section: NonInitialUserSection = { ...common, isInitial: false }
  slots.nonInitial = section
  return section
}

function buildAgentSection(run: IncludesRun): AgentResponseSection {
  const isTerminal = run.status === `completed` || run.status === `failed`
  if (isTerminal) {
    const cached = agentSectionCache.get(run)
    if (cached) return cached
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
  if (isTerminal) agentSectionCache.set(run, section)
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

  return entries
}
