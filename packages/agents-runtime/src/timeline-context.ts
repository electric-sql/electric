import {
  buildEntityTimelineData,
  compareTimelineOrders,
} from './entity-timeline'
import type {
  EntityTimelineData,
  IncludesContextInserted,
  IncludesContextRemoved,
  IncludesInboxMessage,
  IncludesRun,
  IncludesSignal,
  IncludesWakeMessage,
  TimelineOrder,
} from './entity-timeline'
import type { EntityStreamDB } from './entity-stream-db'
import type { ManifestAttachmentEntry, Signal } from './entity-schema'
import type {
  LLMContentBlock,
  LLMMessage,
  TimelineItem,
  TimelineProjectionOpts,
  TimestampedMessage,
} from './types'

function asString(value: unknown, fallback = ``): string {
  if (typeof value === `string`) {
    return value
  }

  if (value === undefined) {
    return fallback
  }

  return JSON.stringify(value)
}

function orderToOffset(order: TimelineOrder): number {
  if (typeof order === `number`) {
    return order
  }

  const match = order.match(/(\d+)$/)
  return match ? Number(match[1]) : 0
}

export function buildTimelineMessages(input: {
  runs: Array<IncludesRun>
  inbox: Array<IncludesInboxMessage>
  wakes?: Array<IncludesWakeMessage>
  signals?: Array<IncludesSignal>
}): Array<LLMMessage> {
  return materializeTimeline({
    runs: input.runs,
    inbox: input.inbox,
    wakes: input.wakes ?? [],
    signals: input.signals ?? [],
    contextInserted: [],
    contextRemoved: [],
    entities: [],
  }).flatMap((item) => defaultProjection(item) ?? [])
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, `&amp;`)
    .replace(/"/g, `&quot;`)
    .replace(/</g, `&lt;`)
    .replace(/>/g, `&gt;`)
}

function renderOpenTag(
  name: string,
  attrs: Record<string, string | number | boolean>
): string {
  const renderedAttrs = Object.entries(attrs)
    .map(([key, value]) => `${key}="${xmlEscape(String(value))}"`)
    .join(` `)

  return renderedAttrs.length > 0 ? `<${name} ${renderedAttrs}>` : `<${name}>`
}

function renderContextInsertedMessage(item: {
  name: string
  attrs: Record<string, string | number | boolean>
  content: string
}): LLMMessage {
  return {
    role: `user`,
    content: `${renderOpenTag(item.name, item.attrs)}${item.content}</${item.name}>`,
  }
}

function renderSupersededTombstone(item: {
  name: string
  attrs: Record<string, string | number | boolean>
  historyOffset: string
  id: string
}): LLMMessage {
  const tombstoneAttrs = {
    ...item.attrs,
    superseded_at_offset: item.historyOffset,
    load: `load_context_history('${item.id}', '${item.historyOffset}')`,
  }

  return {
    role: `user`,
    content: renderOpenTag(item.name, tombstoneAttrs).replace(/>$/, ` />`),
  }
}

function renderRemovedTombstone(item: {
  name: string
  historyOffset: string
  id: string
}): LLMMessage {
  return {
    role: `user`,
    content: `<${item.name} removed_at_offset="${item.historyOffset}" load="load_context_history('${item.id}', '${item.historyOffset}')" />`,
  }
}

const MAX_SIGNAL_DETAIL_CHARS = 1000

function compactSignalDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const rendered = asString(value)
  return rendered.length > MAX_SIGNAL_DETAIL_CHARS
    ? `${rendered.slice(0, MAX_SIGNAL_DETAIL_CHARS)}...`
    : rendered
}

function describeSignal(signal: Signal): string {
  switch (signal.signal) {
    case `SIGINT`:
      return `The active handler invocation was interrupted.`
    case `SIGSTOP`:
      return `The entity was paused.`
    case `SIGCONT`:
      return `The entity was resumed.`
    case `SIGTERM`:
      return `The entity was asked to stop gracefully.`
    case `SIGKILL`:
      return `The entity was killed.`
    case `SIGHUP`:
      return `The entity received a reload signal.`
    case `SIGUSR`:
      return `The entity received a user-defined signal.`
  }
}

function renderSignalMessage(signal: Signal): LLMMessage {
  const attrs: Record<string, string | number | boolean> = {
    signal: signal.signal,
    status: signal.status,
    timestamp: signal.timestamp,
  }
  if (signal.outcome) attrs.outcome = signal.outcome
  if (signal.sender) attrs.sender = signal.sender
  if (signal.handled_at) attrs.handled_at = signal.handled_at
  if (signal.handled_by) attrs.handled_by = signal.handled_by
  if (signal.previous_state) attrs.previous_state = signal.previous_state
  if (signal.new_state) attrs.new_state = signal.new_state

  const details = [describeSignal(signal)]
  const reason = compactSignalDetail(signal.reason)
  if (reason) details.push(`Reason: ${reason}`)
  const payload = compactSignalDetail(signal.payload)
  if (payload) details.push(`Payload: ${payload}`)

  return {
    role: `user`,
    content: `${renderOpenTag(`agent_signal`, attrs)}${xmlEscape(details.join(`\n`))}</agent_signal>`,
  }
}

export function defaultProjection(
  item: TimelineItem
): Array<LLMMessage> | null {
  switch (item.kind) {
    case `inbox`:
      return [{ role: `user`, content: asString(item.payload) }]

    case `wake`:
      return [{ role: `user`, content: asString(item.payload) }]

    case `signal`:
      return [renderSignalMessage(item.signal)]

    case `run`: {
      const messages: Array<LLMMessage> = []

      for (const runItem of item.items) {
        if (runItem.kind === `text`) {
          if (runItem.text.length > 0) {
            messages.push({
              role: `assistant`,
              content: runItem.text,
            })
          }
          continue
        }

        messages.push({
          role: `tool_call`,
          content: asString(runItem.args, `{}`),
          toolCallId: runItem.key,
          toolName: runItem.toolName,
          toolArgs: runItem.args,
        })

        if (runItem.status === `completed` || runItem.status === `failed`) {
          messages.push({
            role: `tool_result`,
            content: runItem.error ?? asString(runItem.result),
            toolCallId: runItem.key,
            isError: runItem.status === `failed`,
          })
        }
      }

      return messages
    }

    case `context_inserted`:
      return item.superseded
        ? [renderSupersededTombstone(item)]
        : [renderContextInsertedMessage(item)]

    case `context_removed`:
      return [renderRemovedTombstone(item)]
  }
}

function materializeRunItem(run: IncludesRun): TimelineItem {
  const items = [
    ...run.texts.map((text) => ({
      kind: `text` as const,
      order: text.order,
      text: text.text,
      status: text.status,
    })),
    ...run.toolCalls.map((toolCall) => ({
      kind: `toolCall` as const,
      order: toolCall.order,
      key: toolCall.key,
      toolName: toolCall.tool_name,
      args: toolCall.args,
      result: toolCall.result,
      error: toolCall.error ?? null,
      status: toolCall.status,
    })),
  ].sort((left, right) => compareTimelineOrders(left.order, right.order))

  return {
    kind: `run`,
    at: orderToOffset(run.order),
    ...(run.finish_reason ? { finishReason: run.finish_reason } : {}),
    items: items.map(({ order: _order, ...item }) => item),
  }
}

function isAbortSignalEntry(entry: {
  kind: string
  item: unknown
}): entry is { kind: `signal`; item: IncludesSignal } {
  if (entry.kind !== `signal`) return false
  const signal = entry.item as IncludesSignal
  return signal.signal === `SIGINT` && signal.outcome === `aborted`
}

function isAbortedRunEntry(entry: {
  kind: string
  item: unknown
}): entry is { kind: `run`; item: IncludesRun } {
  return (
    entry.kind === `run` &&
    (entry.item as IncludesRun).finish_reason === `aborted`
  )
}

function reorderInterruptedRuns<T extends { kind: string; item: unknown }>(
  sortedItems: Array<T>
): Array<T> {
  const items = [...sortedItems]

  for (let signalIndex = 0; signalIndex < items.length; signalIndex++) {
    const signalEntry = items[signalIndex]
    if (!signalEntry || !isAbortSignalEntry(signalEntry)) continue

    // Runtime output is buffered through its producer, while SIGINT is appended
    // directly by the server. Under interruption the signal can therefore get a
    // lower stream offset than the aborted run it interrupted. For model-facing
    // context, present the interrupted assistant run before the interrupt marker
    // so the next user message is interpreted against a coherent transcript.
    let runIndex = -1
    for (let index = signalIndex + 1; index < items.length; index++) {
      const candidate = items[index]
      if (!candidate) continue
      if (isAbortSignalEntry(candidate)) break
      if (isAbortedRunEntry(candidate)) {
        runIndex = index
        break
      }
    }

    if (runIndex === -1) continue

    const [run] = items.splice(runIndex, 1)
    items.splice(signalIndex, 0, run!)
    signalIndex++
  }

  return items
}

export function materializeTimeline(
  data: EntityTimelineData
): Array<TimelineItem> {
  const items: Array<
    | { kind: `inbox`; order: TimelineOrder; item: IncludesInboxMessage }
    | { kind: `wake`; order: TimelineOrder; item: IncludesWakeMessage }
    | { kind: `signal`; order: TimelineOrder; item: IncludesSignal }
    | { kind: `run`; order: TimelineOrder; item: IncludesRun }
    | {
        kind: `context_inserted`
        order: TimelineOrder
        item: IncludesContextInserted
      }
    | {
        kind: `context_removed`
        order: TimelineOrder
        item: IncludesContextRemoved
      }
  > = reorderInterruptedRuns(
    [
      ...data.inbox
        .filter((item) => (item.status ?? `processed`) === `processed`)
        .map((item) => ({
          kind: `inbox` as const,
          order: item.order,
          item,
        })),
      ...data.wakes.map((item) => ({
        kind: `wake` as const,
        order: item.order,
        item,
      })),
      ...(data.signals ?? []).map((item) => ({
        kind: `signal` as const,
        order: item.order,
        item,
      })),
      ...data.runs.map((item) => ({
        kind: `run` as const,
        order: item.order,
        item,
      })),
      ...data.contextInserted.map((item) => ({
        kind: `context_inserted` as const,
        order: item.order,
        item,
      })),
      ...data.contextRemoved.map((item) => ({
        kind: `context_removed` as const,
        order: item.order,
        item,
      })),
    ].sort((left, right) => compareTimelineOrders(left.order, right.order))
  )

  const supersededIds = new Set<string>()
  const contextSuperseded = new Set<string>()
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (!item || item.kind !== `context_inserted`) {
      continue
    }
    const marker = `${item.item.key}:${item.item.id}`
    if (supersededIds.has(item.item.id)) {
      contextSuperseded.add(marker)
      continue
    }
    supersededIds.add(item.item.id)
  }

  return items.map((entry) => {
    switch (entry.kind) {
      case `inbox`:
        return {
          kind: `inbox`,
          at: orderToOffset(entry.order),
          key: entry.item.key,
          payload: entry.item.payload,
        }

      case `wake`:
        return {
          kind: `wake`,
          at: orderToOffset(entry.order),
          payload: entry.item.payload,
        }

      case `signal`:
        return {
          kind: `signal`,
          at: orderToOffset(entry.order),
          signal: entry.item,
        }

      case `run`:
        return materializeRunItem(entry.item)

      case `context_inserted`:
        return {
          kind: `context_inserted`,
          at: orderToOffset(entry.order),
          historyOffset: entry.item.historyOffset,
          id: entry.item.id,
          name: entry.item.name,
          attrs: entry.item.attrs,
          content: entry.item.content,
          superseded: contextSuperseded.has(
            `${entry.item.key}:${entry.item.id}`
          ),
        }

      case `context_removed`:
        return {
          kind: `context_removed`,
          at: orderToOffset(entry.order),
          historyOffset: entry.item.historyOffset,
          id: entry.item.id,
          name: entry.item.name,
        }
    }
  })
}

export function timelineMessages(
  db: EntityStreamDB,
  opts: TimelineProjectionOpts = {}
): Array<TimestampedMessage> {
  const projection = opts.projection ?? defaultProjection
  const since = opts.since ?? Number.NEGATIVE_INFINITY
  const items = materializeTimeline(buildEntityTimelineData(db))
  const attachmentsByInboxKey = attachmentsBySubjectInboxKey(db)
  const messages: Array<TimestampedMessage> = []

  for (const item of items) {
    if (item.at < since) {
      continue
    }

    for (const message of projection(item) ?? []) {
      messages.push({
        ...withInboxAttachments(message, item, attachmentsByInboxKey),
        at: item.at,
      })
    }
  }

  return messages
}

export function timelineToMessages(db: EntityStreamDB): Array<LLMMessage> {
  return timelineMessages(db).map(
    ({ at: _at, ...message }) => message as LLMMessage
  )
}

function isAttachmentManifest(
  value: unknown
): value is ManifestAttachmentEntry {
  return (
    typeof value === `object` &&
    value !== null &&
    `kind` in value &&
    value.kind === `attachment` &&
    `id` in value &&
    typeof value.id === `string` &&
    `subject` in value &&
    typeof value.subject === `object` &&
    value.subject !== null
  )
}

function attachmentsBySubjectInboxKey(
  db: EntityStreamDB
): Map<string, Array<ManifestAttachmentEntry>> {
  const byKey = new Map<string, Array<ManifestAttachmentEntry>>()
  for (const value of db.collections.manifests.toArray) {
    if (
      !isAttachmentManifest(value) ||
      value.role !== `input` ||
      value.status !== `complete` ||
      value.subject.type !== `inbox`
    ) {
      continue
    }
    const existing = byKey.get(value.subject.key) ?? []
    existing.push(value)
    byKey.set(value.subject.key, existing)
  }
  return byKey
}

function withInboxAttachments(
  message: LLMMessage,
  item: TimelineItem,
  attachmentsByInboxKey: Map<string, Array<ManifestAttachmentEntry>>
): LLMMessage {
  if (item.kind !== `inbox` || message.role !== `user`) {
    return message
  }
  const attachments = attachmentsByInboxKey.get(item.key)
  if (!attachments || attachments.length === 0) {
    return message
  }
  const content: Array<LLMContentBlock> =
    typeof message.content === `string`
      ? [{ type: `text`, text: message.content }]
      : [...message.content]
  content.push(
    ...attachments.map((attachment) => ({
      type: `attachment` as const,
      id: attachment.id,
    }))
  )
  return {
    ...message,
    content,
  }
}
