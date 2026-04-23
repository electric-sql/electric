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
  IncludesWakeMessage,
  TimelineOrder,
} from './entity-timeline'
import type { EntityStreamDB } from './entity-stream-db'
import type {
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
}): Array<LLMMessage> {
  return materializeTimeline({
    runs: input.runs,
    inbox: input.inbox,
    wakes: input.wakes ?? [],
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

export function defaultProjection(
  item: TimelineItem
): Array<LLMMessage> | null {
  switch (item.kind) {
    case `inbox`:
      return [{ role: `user`, content: asString(item.payload) }]

    case `wake`:
      return [{ role: `user`, content: asString(item.payload) }]

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
    items: items.map(({ order: _order, ...item }) => item),
  }
}

export function materializeTimeline(
  data: EntityTimelineData
): Array<TimelineItem> {
  const items: Array<
    | { kind: `inbox`; order: TimelineOrder; item: IncludesInboxMessage }
    | { kind: `wake`; order: TimelineOrder; item: IncludesWakeMessage }
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
  > = [
    ...data.inbox.map((item) => ({
      kind: `inbox` as const,
      order: item.order,
      item,
    })),
    ...data.wakes.map((item) => ({
      kind: `wake` as const,
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
          payload: entry.item.payload,
        }

      case `wake`:
        return {
          kind: `wake`,
          at: orderToOffset(entry.order),
          payload: entry.item.payload,
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
  const messages: Array<TimestampedMessage> = []

  for (const item of items) {
    if (item.at < since) {
      continue
    }

    for (const message of projection(item) ?? []) {
      messages.push({ ...message, at: item.at })
    }
  }

  return messages
}

export function timelineToMessages(db: EntityStreamDB): Array<LLMMessage> {
  return timelineMessages(db).map(
    ({ at: _at, ...message }) => message as LLMMessage
  )
}
