import {
  coalesce,
  concat,
  createCollection,
  createLiveQueryCollection,
  eq,
  isNull,
  localOnlyCollectionOptions,
  or,
  toArray,
} from '@durable-streams/state'
import type { InitialQueryBuilder, QueryBuilder } from '@tanstack/db'
import type { EntityStreamDB } from './entity-stream-db'
import type { ChildStatusEntry } from './entity-schema'
import type { ManifestEntry, Wake, WakeMessage } from './types'

export type EntityTimelineState =
  | `pending`
  | `queued`
  | `working`
  | `idle`
  | `error`

export type TimelineOrder = string | number

export type EntityTimelineContentItem =
  | { kind: `text`; text: string }
  | {
      kind: `tool_call`
      toolCallId: string
      toolName: string
      args: Record<string, unknown>
      status: `started` | `args_complete` | `executing` | `completed` | `failed`
      result?: string
      isError: boolean
    }

export type EntityTimelineSection =
  | {
      kind: `user_message`
      from: string | null
      text: string
      timestamp: number
      isInitial: boolean
    }
  | {
      kind: `agent_response`
      items: Array<EntityTimelineContentItem>
      done?: true
      error?: string
    }

export interface IncludesRun {
  key: string
  order: TimelineOrder
  status: `started` | `completed` | `failed`
  finish_reason?: string
  texts: Array<IncludesText>
  toolCalls: Array<IncludesToolCall>
  steps: Array<IncludesStep>
  errors: Array<IncludesError>
}

export interface IncludesText {
  key: string
  run_id: string
  order: TimelineOrder
  status: `streaming` | `completed`
  text: string
  delta_orders?: Array<TimelineOrder>
}

export interface IncludesToolCall {
  key: string
  run_id: string
  order: TimelineOrder
  tool_name: string
  status: `started` | `args_complete` | `executing` | `completed` | `failed`
  args?: unknown
  result?: unknown
  error?: string
}

export interface IncludesStep {
  key: string
  run_id: string
  order: TimelineOrder
  step_number: number
  status: `started` | `completed`
  model_id?: string
  duration_ms?: number
}

export interface IncludesError {
  key: string
  run_id: string
  error_code: string
  message: string
}

export interface IncludesInboxMessage {
  key: string
  order: TimelineOrder
  from: string
  payload: unknown
  timestamp: string
}

export interface IncludesWakeMessage {
  key: string
  order: TimelineOrder
  payload: WakeMessage & { type: `wake` }
}

export interface IncludesContextInserted {
  key: string
  order: TimelineOrder
  historyOffset: string
  id: string
  name: string
  attrs: Record<string, string | number | boolean>
  content: string
  timestamp: string
}

export interface IncludesContextRemoved {
  key: string
  order: TimelineOrder
  historyOffset: string
  id: string
  name: string
  timestamp: string
}

export interface IncludesEntity {
  key: string
  kind: `child` | `source`
  id: string
  url: string
  type?: string
  status?: ChildStatusEntry[`status`]
  observed: boolean
  wake?: Wake
}

export interface EntityTimelineData {
  runs: Array<IncludesRun>
  inbox: Array<IncludesInboxMessage>
  wakes: Array<IncludesWakeMessage>
  contextInserted: Array<IncludesContextInserted>
  contextRemoved: Array<IncludesContextRemoved>
  entities: Array<IncludesEntity>
}

function normalizeTimelineRun(run: IncludesRun): IncludesRun {
  const texts = run.texts
    .map((text) => {
      const earliestDeltaOrder = text.delta_orders?.[0]
      const order =
        earliestDeltaOrder !== undefined &&
        compareTimelineOrders(earliestDeltaOrder, text.order) < 0
          ? earliestDeltaOrder
          : text.order
      return { ...text, order }
    })
    .sort(compareTimelineOrder)
  const toolCalls = [...run.toolCalls].sort(compareTimelineOrder)
  const steps = [...run.steps].sort(
    (left, right) => left.step_number - right.step_number
  )

  let order = run.order
  const candidateOrders: Array<TimelineOrder> = [
    run.order,
    ...texts.map((text) => text.order),
    ...toolCalls.map((toolCall) => toolCall.order),
    ...steps.map((step) => step.order),
  ]

  for (const candidate of candidateOrders) {
    if (compareTimelineOrders(candidate, order) < 0) {
      order = candidate
    }
  }

  return {
    ...run,
    order,
    texts,
    toolCalls,
    steps,
  }
}

function normalizeOptionalEntityField<T extends string>(
  value: T | `` | undefined
): T | undefined {
  return value === `` ? undefined : value
}

function mergeTimelineEntities(
  existing: IncludesEntity,
  incoming: IncludesEntity
): IncludesEntity {
  const child =
    existing.kind === `child`
      ? existing
      : incoming.kind === `child`
        ? incoming
        : undefined
  const source =
    existing.kind === `source`
      ? existing
      : incoming.kind === `source`
        ? incoming
        : undefined
  const primary = child ?? existing

  return {
    key: primary.key,
    kind: child ? `child` : `source`,
    id: child?.id ?? source?.id ?? primary.id,
    url: primary.url,
    type: normalizeOptionalEntityField(
      child?.type ?? source?.type ?? existing.type ?? incoming.type
    ),
    status: normalizeOptionalEntityField(
      child?.status ?? source?.status ?? existing.status ?? incoming.status
    ),
    observed: existing.observed || incoming.observed,
    wake: child?.wake ?? source?.wake ?? existing.wake ?? incoming.wake,
  }
}

export function normalizeTimelineEntities(
  entities: Array<IncludesEntity>
): Array<IncludesEntity> {
  const mergedByUrl = new Map<string, IncludesEntity>()
  const orderedUrls: Array<string> = []

  for (const entity of entities) {
    const normalized: IncludesEntity = {
      ...entity,
      type: normalizeOptionalEntityField(entity.type),
      status: normalizeOptionalEntityField(entity.status),
    }
    const existing = mergedByUrl.get(normalized.url)
    if (!existing) {
      mergedByUrl.set(normalized.url, normalized)
      orderedUrls.push(normalized.url)
      continue
    }
    mergedByUrl.set(normalized.url, mergeTimelineEntities(existing, normalized))
  }

  return orderedUrls.map((url) => mergedByUrl.get(url)!)
}

export function normalizeEntityTimelineData(
  data: EntityTimelineData
): EntityTimelineData {
  return {
    runs: data.runs.map(normalizeTimelineRun).sort(compareTimelineOrder),
    inbox: data.inbox,
    wakes: data.wakes,
    contextInserted: data.contextInserted,
    contextRemoved: data.contextRemoved,
    entities: normalizeTimelineEntities(data.entities),
  }
}

type OrderedValue<T> = T & { order: TimelineOrder }
type MaybeOrderedValue<T> = T & { order?: TimelineOrder }
type OrderedRow<T> = T & { _orderToken: string }
type WithoutOrderToken<T> = T extends unknown ? Omit<T, `_orderToken`> : never

type RunRow = OrderedValue<
  EntityStreamDB[`collections`][`runs`][`toArray`][number]
>
type TextRow = OrderedValue<
  EntityStreamDB[`collections`][`texts`][`toArray`][number]
>
type TextDeltaRow = OrderedValue<
  EntityStreamDB[`collections`][`textDeltas`][`toArray`][number]
>
type ToolCallRow = OrderedValue<
  EntityStreamDB[`collections`][`toolCalls`][`toArray`][number]
>
type StepRow = OrderedValue<
  EntityStreamDB[`collections`][`steps`][`toArray`][number]
>
type ErrorRow = EntityStreamDB[`collections`][`errors`][`toArray`][number]
type InboxRow = OrderedValue<
  EntityStreamDB[`collections`][`inbox`][`toArray`][number]
>
type WakeRow = OrderedValue<
  EntityStreamDB[`collections`][`wakes`][`toArray`][number]
>
type ContextInsertedValueRow =
  EntityStreamDB[`collections`][`contextInserted`][`toArray`][number]
type ContextRemovedValueRow =
  EntityStreamDB[`collections`][`contextRemoved`][`toArray`][number]
type ContextInsertedRow = OrderedValue<ContextInsertedValueRow>
type ContextRemovedRow = OrderedValue<ContextRemovedValueRow>

type ManifestRow = MaybeOrderedValue<ManifestEntry>
type ChildStatusRow = MaybeOrderedValue<ChildStatusEntry>

function readInlineSeq(row: object): number | undefined {
  const seq = Reflect.get(row, `_seq`)
  return typeof seq === `number` ? seq : undefined
}

function toSeqOrderToken(seq: number): string {
  return `seq:${seq.toString().padStart(12, `0`)}`
}

function toPendingOrderToken(collectionId: string, index: number): string {
  return `pending:${collectionId}:${index.toString().padStart(12, `0`)}`
}

function toTimelineOrder(index: number): TimelineOrder {
  return index.toString().padStart(20, `0`)
}

function toComparableTimelineOrderValue(order: TimelineOrder): string {
  return typeof order === `number` ? order.toString().padStart(20, `0`) : order
}

export function compareTimelineOrders(
  left: TimelineOrder,
  right: TimelineOrder
): number {
  return toComparableTimelineOrderValue(left).localeCompare(
    toComparableTimelineOrderValue(right)
  )
}

function compareTimelineOrder(
  left: { order: TimelineOrder },
  right: { order: TimelineOrder }
): number {
  return compareTimelineOrders(left.order, right.order)
}

function readRequiredOrderToken<TRow extends { key: string | number }>(
  collection: {
    id?: string
    toArray: Array<TRow>
    __electricRowOffsets?: Map<string | number, string>
  },
  row: TRow,
  index: number
): string {
  const offset = collection.__electricRowOffsets?.get(row.key)
  if (offset) {
    return `offset:${offset}`
  }

  const inlineSeq = readInlineSeq(row)
  if (inlineSeq !== undefined) {
    return toSeqOrderToken(inlineSeq)
  }

  return toPendingOrderToken(collection.id ?? `collection`, index)
}

function readOptionalOrderToken<TRow extends { key: string | number }>(
  collection: {
    toArray: Array<TRow>
    __electricRowOffsets?: Map<string | number, string>
  },
  row: TRow
): string | undefined {
  const offset = collection.__electricRowOffsets?.get(row.key)
  if (offset) {
    return `offset:${offset}`
  }

  const inlineSeq = readInlineSeq(row)
  return inlineSeq === undefined ? undefined : toSeqOrderToken(inlineSeq)
}

function withOrderToken<TRow extends { key: string | number }>(collection: {
  id?: string
  toArray: Array<TRow>
  __electricRowOffsets?: Map<string | number, string>
}): Array<OrderedRow<TRow>> {
  return collection.toArray.map((row, index) => ({
    ...row,
    _orderToken: readRequiredOrderToken(collection, row, index),
  }))
}

function withOptionalOrderToken<
  TRow extends { key: string | number },
>(collection: {
  toArray: Array<TRow>
  __electricRowOffsets?: Map<string | number, string>
}): Array<TRow & { _orderToken?: string }> {
  return collection.toArray.map((row) => {
    const orderToken = readOptionalOrderToken(collection, row)
    return orderToken === undefined
      ? { ...row }
      : { ...row, _orderToken: orderToken }
  })
}

function getOrderableCollection<TRow extends { key: string | number }>(
  collection:
    | {
        id?: string
        toArray: Array<TRow>
        __electricRowOffsets?: Map<string | number, string>
      }
    | undefined,
  id: string
): {
  id?: string
  toArray: Array<TRow>
  __electricRowOffsets?: Map<string | number, string>
} {
  if (!collection) {
    throw new Error(
      `[agent-runtime] entity timeline requires collection "${id}" but it was not registered`
    )
  }

  return collection
}

function createOrderIndex(
  groups: ReadonlyArray<ReadonlyArray<{ _orderToken: string }>>
): Map<string, TimelineOrder> {
  const tokens = new Set<string>()
  for (const group of groups) {
    for (const row of group) {
      tokens.add(row._orderToken)
    }
  }

  return new Map(
    [...tokens]
      .sort((left, right) => left.localeCompare(right))
      .map((token, index) => [token, toTimelineOrder(index + 1)] as const)
  )
}

function withoutOrderToken<TRow extends object & { _orderToken?: string }>(
  row: TRow
): WithoutOrderToken<TRow> {
  const { _orderToken: _ignored, ...value } = row
  return value as WithoutOrderToken<TRow>
}

function orderTokenToHistoryOffset(orderToken: string): string {
  return orderToken.startsWith(`offset:`)
    ? orderToken.slice(`offset:`.length)
    : orderToken
}

function withOrderFromOrderIndex<TRow extends object & { _orderToken: string }>(
  rows: Array<TRow>,
  orderIndex: Map<string, TimelineOrder>
): Array<OrderedValue<WithoutOrderToken<TRow>>> {
  return rows.map((row) => ({
    ...withoutOrderToken(row),
    order: orderIndex.get(row._orderToken) ?? `~`,
  }))
}

function withOrderAndHistoryOffsetFromOrderIndex<
  TRow extends object & { _orderToken: string },
>(
  rows: Array<TRow>,
  orderIndex: Map<string, TimelineOrder>
): Array<OrderedValue<WithoutOrderToken<TRow>> & { historyOffset: string }> {
  return rows.map((row) => ({
    ...withoutOrderToken(row),
    order: orderIndex.get(row._orderToken) ?? `~`,
    historyOffset: orderTokenToHistoryOffset(row._orderToken),
  }))
}

function withOptionalOrderFromOrderIndex<
  TRow extends object & { _orderToken?: string },
>(
  rows: Array<TRow>,
  orderIndex: Map<string, TimelineOrder>
): Array<MaybeOrderedValue<WithoutOrderToken<TRow>>> {
  return rows.map((row) => {
    const value = withoutOrderToken(row)
    return row._orderToken === undefined
      ? { ...value }
      : {
          ...value,
          order: orderIndex.get(row._orderToken) ?? `~`,
        }
  })
}

function hasOrderToken<TRow extends { _orderToken?: string }>(
  row: TRow
): row is TRow & { _orderToken: string } {
  return typeof row._orderToken === `string`
}

export function getEntityState(
  runs: Array<IncludesRun>,
  inbox: Array<IncludesInboxMessage>
): EntityTimelineState {
  if (runs.length === 0 && inbox.length === 0) return `pending`

  const lastRun = runs.at(-1)
  const lastInbox = inbox.at(-1)

  if (!lastRun) return `queued`

  if (lastInbox && compareTimelineOrders(lastInbox.order, lastRun.order) > 0) {
    return `queued`
  }

  if (lastRun.status === `failed`) return `error`
  if (lastRun.status === `completed`) return `idle`

  if (lastRun.errors.length > 0) return `error`

  return `working`
}

function buildTextContentById(
  textDeltas: Array<TextDeltaRow>
): Map<string, string> {
  const deltasById = new Map<string, string>()

  for (const delta of [...textDeltas].sort(compareTimelineOrder)) {
    deltasById.set(
      delta.text_id,
      `${deltasById.get(delta.text_id) ?? ``}${delta.delta}`
    )
  }

  return deltasById
}

function buildIncludesRuns(input: {
  runs: Array<RunRow>
  texts: Array<TextRow>
  textDeltas: Array<TextDeltaRow>
  toolCalls: Array<ToolCallRow>
  steps: Array<StepRow>
  errors: Array<ErrorRow>
}): Array<IncludesRun> {
  const textContentById = buildTextContentById(input.textDeltas)
  const deltaOrdersByTextId = new Map<string, Array<TimelineOrder>>()
  const textsByRun = new Map<string, IncludesRun[`texts`]>()
  const toolCallsByRun = new Map<string, IncludesRun[`toolCalls`]>()
  const stepsByRun = new Map<string, IncludesRun[`steps`]>()
  const errorsByRun = new Map<string, IncludesRun[`errors`]>()

  for (const delta of [...input.textDeltas].sort(compareTimelineOrder)) {
    const entries = deltaOrdersByTextId.get(delta.text_id) ?? []
    entries.push(delta.order)
    deltaOrdersByTextId.set(delta.text_id, entries)
  }

  for (const text of input.texts) {
    if (!text.run_id) continue
    const entries = textsByRun.get(text.run_id) ?? []
    let order = text.order
    for (const candidate of deltaOrdersByTextId.get(text.key) ?? []) {
      if (compareTimelineOrders(candidate, order) < 0) {
        order = candidate
      }
    }
    entries.push({
      key: text.key,
      run_id: text.run_id,
      order,
      status: text.status,
      text: textContentById.get(text.key) ?? ``,
      delta_orders: deltaOrdersByTextId.get(text.key) ?? [],
    })
    textsByRun.set(text.run_id, entries)
  }

  for (const toolCall of input.toolCalls) {
    if (!toolCall.run_id) continue
    const entries = toolCallsByRun.get(toolCall.run_id) ?? []
    entries.push({
      key: toolCall.key,
      run_id: toolCall.run_id,
      order: toolCall.order,
      tool_name: toolCall.tool_name,
      status: toolCall.status,
      args: toolCall.args,
      result: toolCall.result,
      error: toolCall.error,
    })
    toolCallsByRun.set(toolCall.run_id, entries)
  }

  for (const step of input.steps) {
    if (!step.run_id) continue
    const entries = stepsByRun.get(step.run_id) ?? []
    entries.push({
      key: step.key,
      run_id: step.run_id,
      order: step.order,
      step_number: step.step_number,
      status: step.status,
      model_id: step.model_id,
      duration_ms: step.duration_ms,
    })
    stepsByRun.set(step.run_id, entries)
  }

  for (const error of input.errors) {
    if (!error.run_id) continue
    const entries = errorsByRun.get(error.run_id) ?? []
    entries.push({
      key: error.key,
      run_id: error.run_id,
      error_code: error.error_code,
      message: error.message,
    })
    errorsByRun.set(error.run_id, entries)
  }

  return [...input.runs].sort(compareTimelineOrder).map((run) => ({
    key: run.key,
    order: run.order,
    status: run.status,
    finish_reason: run.finish_reason,
    texts: [...(textsByRun.get(run.key) ?? [])].sort(compareTimelineOrder),
    toolCalls: [...(toolCallsByRun.get(run.key) ?? [])].sort(
      compareTimelineOrder
    ),
    steps: [...(stepsByRun.get(run.key) ?? [])].sort(
      (left, right) => left.step_number - right.step_number
    ),
    errors: [...(errorsByRun.get(run.key) ?? [])],
  }))
}

function buildInboxMessages(
  inbox: Array<InboxRow>
): Array<IncludesInboxMessage> {
  return [...inbox].sort(compareTimelineOrder).map((message) => ({
    key: message.key,
    order: message.order,
    from: message.from,
    payload: message.payload,
    timestamp: message.timestamp,
  }))
}

function buildWakeMessages(wakes: Array<WakeRow>): Array<IncludesWakeMessage> {
  return [...wakes].sort(compareTimelineOrder).map((wake) => ({
    key: wake.key,
    order: wake.order,
    payload: {
      type: `wake`,
      timestamp: wake.timestamp,
      source: wake.source,
      timeout: wake.timeout,
      changes: wake.changes,
      ...(wake.finished_child ? { finished_child: wake.finished_child } : {}),
      ...(wake.other_children ? { other_children: wake.other_children } : {}),
    },
  }))
}

function buildContextInsertedMessages(
  entries: Array<ContextInsertedRow & { historyOffset: string }>
): Array<IncludesContextInserted> {
  return [...entries].sort(compareTimelineOrder).map((entry) => ({
    key: entry.key,
    order: entry.order,
    historyOffset: entry.historyOffset,
    id: entry.id,
    name: entry.name,
    attrs: entry.attrs,
    content: entry.content,
    timestamp: entry.timestamp,
  }))
}

function buildContextRemovedMessages(
  entries: Array<ContextRemovedRow & { historyOffset: string }>
): Array<IncludesContextRemoved> {
  return [...entries].sort(compareTimelineOrder).map((entry) => ({
    key: entry.key,
    order: entry.order,
    historyOffset: entry.historyOffset,
    id: entry.id,
    name: entry.name,
    timestamp: entry.timestamp,
  }))
}

function buildTimelineEntities(input: {
  manifests: Array<ManifestRow>
  childStatuses: Array<ChildStatusRow>
}): Array<IncludesEntity> {
  const statusByUrl = new Map(
    input.childStatuses.map((status) => [status.entity_url, status] as const)
  )

  return [...input.manifests]
    .filter(
      (
        manifest
      ): manifest is ManifestRow &
        (
          | { kind: `child`; id: string; entity_url: string }
          | {
              kind: `source`
              sourceType: string
              sourceRef: string
              config: Record<string, unknown>
            }
        ) =>
        manifest.kind === `child` ||
        (manifest.kind === `source` && manifest.sourceType === `entity`)
    )
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === `child` ? -1 : 1
      }
      if (left.order && right.order) {
        const orderCompare = compareTimelineOrders(left.order, right.order)
        if (orderCompare !== 0) {
          return orderCompare
        }
      } else if (left.order) {
        return -1
      } else if (right.order) {
        return 1
      }
      const leftUrl =
        left.kind === `child`
          ? left.entity_url
          : String(left.config.entityUrl ?? ``)
      const rightUrl =
        right.kind === `child`
          ? right.entity_url
          : String(right.config.entityUrl ?? ``)
      return leftUrl.localeCompare(rightUrl)
    })
    .map((manifest) => {
      if (manifest.kind === `child`) {
        const status = statusByUrl.get(manifest.entity_url)
        return {
          key: manifest.entity_url,
          kind: `child` as const,
          id: manifest.id,
          url: manifest.entity_url,
          type: manifest.entity_type,
          status: status?.status,
          observed: manifest.observed,
          wake: manifest.wake,
        }
      }

      const entityUrl = String(manifest.config.entityUrl ?? manifest.sourceRef)
      const status = statusByUrl.get(entityUrl)
      return {
        key: entityUrl,
        kind: `source` as const,
        id: manifest.sourceRef,
        url: entityUrl,
        type: status?.entity_type,
        status: status?.status,
        observed: true,
        wake: manifest.wake,
      }
    })
}

export function buildEntityTimelineData(
  db: EntityStreamDB
): EntityTimelineData {
  const runs = withOrderToken(db.collections.runs)
  const texts = withOrderToken(db.collections.texts)
  const textDeltas = withOrderToken(db.collections.textDeltas)
  const toolCalls = withOrderToken(db.collections.toolCalls)
  const steps = withOrderToken(db.collections.steps)
  const inbox = withOrderToken(db.collections.inbox)
  const wakes = withOrderToken(db.collections.wakes)
  const contextInserted = withOrderToken(
    getOrderableCollection<ContextInsertedValueRow>(
      db.collections.contextInserted as
        | {
            id?: string
            toArray: Array<ContextInsertedValueRow>
            __electricRowOffsets?: Map<string | number, string>
          }
        | undefined,
      `contextInserted`
    )
  )
  const contextRemoved = withOrderToken(
    getOrderableCollection<ContextRemovedValueRow>(
      db.collections.contextRemoved as
        | {
            id?: string
            toArray: Array<ContextRemovedValueRow>
            __electricRowOffsets?: Map<string | number, string>
          }
        | undefined,
      `contextRemoved`
    )
  )
  const manifests = withOptionalOrderToken(
    getOrderableCollection<ManifestRow>(
      db.collections.manifests as typeof db.collections.manifests | undefined,
      `manifests`
    )
  )
  const childStatuses = withOptionalOrderToken(
    getOrderableCollection<ChildStatusRow>(
      db.collections.childStatus as
        | typeof db.collections.childStatus
        | undefined,
      `childStatus`
    )
  )
  const orderIndex = createOrderIndex([
    runs,
    texts,
    textDeltas,
    toolCalls,
    steps,
    inbox,
    wakes,
    contextInserted,
    contextRemoved,
    manifests.filter(hasOrderToken),
  ])

  return normalizeEntityTimelineData({
    runs: buildIncludesRuns({
      runs: withOrderFromOrderIndex(runs, orderIndex),
      texts: withOrderFromOrderIndex(texts, orderIndex),
      textDeltas: withOrderFromOrderIndex(textDeltas, orderIndex),
      toolCalls: withOrderFromOrderIndex(toolCalls, orderIndex),
      steps: withOrderFromOrderIndex(steps, orderIndex),
      errors: db.collections.errors.toArray,
    }),
    inbox: buildInboxMessages(withOrderFromOrderIndex(inbox, orderIndex)),
    wakes: buildWakeMessages(withOrderFromOrderIndex(wakes, orderIndex)),
    contextInserted: buildContextInsertedMessages(
      withOrderAndHistoryOffsetFromOrderIndex(contextInserted, orderIndex)
    ),
    contextRemoved: buildContextRemovedMessages(
      withOrderAndHistoryOffsetFromOrderIndex(contextRemoved, orderIndex)
    ),
    entities: buildTimelineEntities({
      manifests: withOptionalOrderFromOrderIndex(manifests, orderIndex),
      childStatuses: withOptionalOrderFromOrderIndex(childStatuses, orderIndex),
    }),
  })
}

const TIMELINE_KEY = `timeline` as const

type TimelineSeedRow = { key: typeof TIMELINE_KEY }

function createTimelineSeedCollection(db: EntityStreamDB) {
  return createCollection(
    localOnlyCollectionOptions<TimelineSeedRow>({
      id: `${String(db.collections.runs.id)}:timeline-seed`,
      getKey: (row) => row.key,
      initialData: [{ key: TIMELINE_KEY }],
    })
  )
}

function cachedCollectionFactory<T>(
  factory: (db: EntityStreamDB) => T
): (db: EntityStreamDB) => T {
  const cache = new WeakMap<object, T>()
  return function getCachedCollection(db: EntityStreamDB): T {
    const cached = cache.get(db as object)
    if (cached) {
      return cached
    }
    const collection = factory(db)
    cache.set(db as object, collection)
    return collection
  }
}

const getTimelineSeedCollection = cachedCollectionFactory(
  createTimelineSeedCollection
)

const getEntityRunsCollection = cachedCollectionFactory((db: EntityStreamDB) =>
  createLiveQueryCollection({
    id: `${String(db.collections.runs.id)}:runs-live`,
    query: (q) =>
      q.from({ run: db.collections.runs }).select(({ run }) => ({
        timelineKey: TIMELINE_KEY,
        key: run.key,
        order: coalesce(run._seq, -1),
        status: run.status,
        finish_reason: run.finish_reason,
      })),
  })
)

const getEntityEntitiesCollection = cachedCollectionFactory(
  (db: EntityStreamDB) =>
    createLiveQueryCollection({
      id: `${String(db.collections.manifests.id)}:entities-live`,
      query: (q) =>
        q
          .from({ manifest: db.collections.manifests })
          .where(({ manifest }) =>
            or(eq(manifest.kind, `child`), eq(manifest.kind, `source`))
          )
          .select(({ manifest }) => ({
            timelineKey: TIMELINE_KEY,
            manifestOrder: coalesce(manifest._seq, -1),
            kind: manifest.kind,
            key: coalesce(manifest.entity_url, manifest.sourceRef),
            id: coalesce(manifest.id, manifest.sourceRef),
            url: coalesce(manifest.entity_url, manifest.sourceRef),
            type: manifest.entity_type,
            observed: or(
              eq(manifest.kind, `source`),
              coalesce(manifest.observed, false)
            ),
            wake: manifest.wake,
          })),
    })
)

const getEntityInboxCollection = cachedCollectionFactory((db: EntityStreamDB) =>
  createLiveQueryCollection({
    id: `${String(db.collections.inbox.id)}:inbox-live`,
    query: (q) =>
      q.from({ inbox: db.collections.inbox }).select(({ inbox }) => ({
        timelineKey: TIMELINE_KEY,
        key: inbox.key,
        order: coalesce(inbox._seq, -1),
        from: inbox.from,
        payload: inbox.payload,
        timestamp: inbox.timestamp,
      })),
  })
)

const getEntityWakesCollection = cachedCollectionFactory((db: EntityStreamDB) =>
  createLiveQueryCollection({
    id: `${String(db.collections.wakes.id)}:wakes-live`,
    query: (q) =>
      q.from({ wake: db.collections.wakes }).select(({ wake }) => ({
        timelineKey: TIMELINE_KEY,
        key: wake.key,
        order: coalesce(wake._seq, -1),
        payload: {
          type: `wake` as const,
          timestamp: wake.timestamp,
          source: wake.source,
          timeout: wake.timeout,
          changes: wake.changes,
          finished_child: wake.finished_child,
          other_children: wake.other_children,
        },
      })),
  })
)

type EntityQueryBuilder = (q: InitialQueryBuilder) => QueryBuilder<any>

export function createEntityIncludesQuery(
  db: EntityStreamDB
): EntityQueryBuilder {
  const seedCollection = getTimelineSeedCollection(db)
  const runsCollection = getEntityRunsCollection(db)
  const inboxCollection = getEntityInboxCollection(db)
  const wakesCollection = getEntityWakesCollection(db)
  const entitiesCollection = getEntityEntitiesCollection(db)

  return (q: InitialQueryBuilder) =>
    q.from({ timeline: seedCollection }).select(({ timeline }) => ({
      key: timeline.key,
      runs: toArray(
        q
          .from({ run: runsCollection })
          .where(({ run }) => eq(run.timelineKey, timeline.key))
          .orderBy(({ run }) => run.order)
          .select(({ run }) => ({
            key: run.key,
            order: run.order,
            status: run.status,
            finish_reason: run.finish_reason,
            texts: toArray(
              q
                .from({ text: db.collections.texts })
                .where(({ text }) => eq(text.run_id, run.key))
                .orderBy(({ text }) => coalesce(text._seq, -1))
                .select(({ text }) => ({
                  key: text.key,
                  run_id: text.run_id,
                  order: coalesce(text._seq, -1),
                  status: text.status,
                  delta_orders: toArray(
                    q
                      .from({ delta: db.collections.textDeltas })
                      .where(({ delta }) => eq(delta.text_id, text.key))
                      .orderBy(({ delta }) => coalesce(delta._seq, -1))
                      .select(({ delta }) => coalesce(delta._seq, -1))
                  ),
                  text: concat(
                    toArray(
                      q
                        .from({ delta: db.collections.textDeltas })
                        .where(({ delta }) => eq(delta.text_id, text.key))
                        .orderBy(({ delta }) => coalesce(delta._seq, -1))
                        .select(({ delta }) => delta.delta)
                    )
                  ),
                }))
            ),
            toolCalls: toArray(
              q
                .from({ toolCall: db.collections.toolCalls })
                .where(({ toolCall }) => eq(toolCall.run_id, run.key))
                .orderBy(({ toolCall }) => coalesce(toolCall._seq, -1))
                .select(({ toolCall }) => ({
                  key: toolCall.key,
                  run_id: toolCall.run_id,
                  order: coalesce(toolCall._seq, -1),
                  tool_name: toolCall.tool_name,
                  status: toolCall.status,
                  args: toolCall.args,
                  result: toolCall.result,
                  error: toolCall.error,
                }))
            ),
            steps: toArray(
              q
                .from({ step: db.collections.steps })
                .where(({ step }) => eq(step.run_id, run.key))
                .orderBy(({ step }) => step.step_number)
                .orderBy(({ step }) => coalesce(step._seq, -1))
                .select(({ step }) => ({
                  key: step.key,
                  run_id: step.run_id,
                  order: coalesce(step._seq, -1),
                  step_number: step.step_number,
                  status: step.status,
                  model_id: step.model_id,
                  duration_ms: step.duration_ms,
                }))
            ),
            errors: toArray(
              q
                .from({ error: db.collections.errors })
                .where(({ error }) => eq(error.run_id, run.key))
                .orderBy(({ error }) => error.key)
                .select(({ error }) => ({
                  key: error.key,
                  run_id: error.run_id,
                  error_code: error.error_code,
                  message: error.message,
                }))
            ),
          }))
      ),
      inbox: toArray(
        q
          .from({ inbox: inboxCollection })
          .where(({ inbox }) => eq(inbox.timelineKey, timeline.key))
          .orderBy(({ inbox }) => inbox.order)
          .select(({ inbox }) => ({
            key: inbox.key,
            order: inbox.order,
            from: inbox.from,
            payload: inbox.payload,
            timestamp: inbox.timestamp,
          }))
      ),
      wakes: toArray(
        q
          .from({ wake: wakesCollection })
          .where(({ wake }) => eq(wake.timelineKey, timeline.key))
          .orderBy(({ wake }) => wake.order)
          .select(({ wake }) => ({
            key: wake.key,
            order: wake.order,
            payload: wake.payload,
          }))
      ),
      entities: toArray(
        q
          .from({ entity: entitiesCollection })
          .where(({ entity }) => eq(entity.timelineKey, timeline.key))
          .orderBy(({ entity }) => entity.kind)
          .orderBy(({ entity }) => entity.manifestOrder)
          .select(({ entity }) => ({
            key: entity.key,
            kind: entity.kind,
            id: entity.id,
            url: entity.url,
            type:
              entity.type ??
              concat(
                toArray(
                  q
                    .from({ childStatus: db.collections.childStatus })
                    .where(({ childStatus }) =>
                      eq(childStatus.entity_url, entity.url)
                    )
                    .select(({ childStatus }) => childStatus.entity_type)
                )
              ),
            status: concat(
              toArray(
                q
                  .from({ childStatus: db.collections.childStatus })
                  .where(({ childStatus }) =>
                    eq(childStatus.entity_url, entity.url)
                  )
                  .select(({ childStatus }) => childStatus.status)
              )
            ),
            observed: entity.observed,
            wake: entity.wake,
          }))
      ),
    }))
}

export function createEntityErrorsQuery(
  db: EntityStreamDB
): EntityQueryBuilder {
  return (q: InitialQueryBuilder) =>
    q
      .from({ errors: db.collections.errors })
      .where(({ errors }) => isNull(errors.run_id))
      .select(({ errors }) => ({
        key: errors.key,
        error_code: errors.error_code,
        message: errors.message,
      }))
}
