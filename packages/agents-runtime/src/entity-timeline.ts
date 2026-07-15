import {
  and,
  coalesce,
  concat,
  count,
  createCollection,
  createLiveQueryCollection,
  eq,
  gt,
  isNull,
  isUndefined,
  like,
  min,
  localOnlyCollectionOptions,
  or,
  sum,
  toArray,
} from '@durable-streams/state/db'
import { BasicIndex, caseWhen } from '@tanstack/db'
import type {
  Collection,
  InitialQueryBuilder,
  QueryBuilder,
} from '@tanstack/db'
import type { EntityStreamDB } from './entity-stream-db'
import { formatPointerOrderToken, type EventPointer } from './event-pointer'
import type { ChildStatusEntry, MessageReceived, Signal } from './entity-schema'
import type { ManifestEntry, Wake, WakeMessage } from './types'

export const TIMELINE_ORDER_FALLBACK = `~`

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
      error?: string
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
      // Summed across all steps of the run that produced this section.
      // `input` is the uncached side only (fresh tokens + cache writes)
      // — see `StepValue.input_tokens`. Either side may be missing if
      // the provider didn't report it (e.g. older events recorded
      // before tokens were persisted).
      tokens?: {
        input?: number
        output?: number
      }
    }
  | {
      kind: `wake`
      payload: WakeMessage & { type: `wake` }
      timestamp: number
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
  // Per-run token totals summed across all `steps` of the run.
  // Either side is omitted if no step reported that side; the whole
  // field is omitted if no step reported either. Computed in the
  // query layer (or by `buildIncludesRuns` for in-memory snapshots)
  // so consumers don't re-aggregate.
  tokens?: {
    input?: number
    output?: number
  }
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
  input_tokens?: number
  output_tokens?: number
}

export interface IncludesError {
  key: string
  run_id: string
  error_code: string
  message: string
}

export type IncludesInboxMessage = Omit<
  MessageReceived,
  `_seq` | `from` | `timestamp` | `mode` | `status`
> & {
  order: TimelineOrder
  from: string
  timestamp: string
  mode?: NonNullable<MessageReceived[`mode`]>
  status?: NonNullable<MessageReceived[`status`]>
}

export interface IncludesWakeMessage {
  key: string
  order: TimelineOrder
  payload: WakeMessage & { type: `wake` }
}

export type IncludesSignal = Omit<Signal, `_seq`> & {
  order: TimelineOrder
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
  signals: Array<IncludesSignal>
  contextInserted: Array<IncludesContextInserted>
  contextRemoved: Array<IncludesContextRemoved>
  entities: Array<IncludesEntity>
}

export type EntityTimelineInboxMode = `processed` | `all`

/**
 * A consumer-provided source unioned into the timeline query under its own
 * row key. The projection must include `order` (timeline order token) and
 * `key`; all other fields are passed through to the timeline row.
 */
export type EntityTimelineCustomSource = (
  q: InitialQueryBuilder
) => QueryBuilder<any>

export interface EntityTimelineQueryOptions {
  inboxMode?: EntityTimelineInboxMode
  /**
   * Additional sources merged into the timeline, keyed by row name. Names
   * must not collide with the built-in sources (`inbox`, `run`, `wake`,
   * `signal`, `manifest`).
   */
  customSources?: Record<string, EntityTimelineCustomSource>
}

export interface EntityTimelineTextChunk {
  key: string
  text_id: string
  run_id: string
  order: TimelineOrder
  delta: string
}

export interface EntityTimelineTextItem {
  key: string
  run_id?: string
  order: TimelineOrder
  status: `streaming` | `completed`
  content: string
}

export interface EntityTimelineToolCallItem {
  key: string
  run_id?: string
  order: TimelineOrder
  tool_call_id?: string
  tool_name: string
  status: `started` | `args_complete` | `executing` | `completed` | `failed`
  args?: unknown
  result?: unknown
  error?: string
}

export type EntityTimelineRunItem =
  | {
      $key: string
      text: EntityTimelineTextItem
      toolCall?: undefined
    }
  | {
      $key: string
      text?: undefined
      toolCall: EntityTimelineToolCallItem
    }

export interface EntityTimelineReasoningItem {
  key: string
  run_id?: string
  order: TimelineOrder
  status: `streaming` | `completed`
  // The concatenated `reasoning_delta` content lives under
  // `body.content` rather than top-level — the wrapper is what
  // forces TanStack DB to materialize the include before the row
  // reaches `useLiveQuery`. See the timeline-query comment.
  body?: { content: string }
  // Optional bolded title parsed at write time — only OpenAI Responses
  // emits these; null for Anthropic / DeepSeek / Moonshot.
  summary_title?: string
  // Anthropic redacted-thinking opaque payload. Persist verbatim so we
  // can echo it back on the next turn; the UI shows a placeholder.
  encrypted?: string
}

export interface EntityTimelineStepItem {
  key: string
  run_id?: string
  order: TimelineOrder
  step_number: number
  status: `started` | `completed`
  model_id?: string
  duration_ms?: number
  input_tokens?: number
  output_tokens?: number
}

export interface EntityTimelineErrorItem {
  key: string
  run_id?: string
  error_code: string
  message: string
}

export interface EntityTimelineRunRow {
  key: string
  order: TimelineOrder
  status: `started` | `completed` | `failed`
  finish_reason?: string
  items: Collection<EntityTimelineRunItem>
  reasoning: Collection<EntityTimelineReasoningItem>
  steps: Collection<EntityTimelineStepItem>
  errors: Collection<EntityTimelineErrorItem>
  // Per-run token totals summed across all `steps` of the run.
  // Same shape as `IncludesRun.tokens` — the query layer resolves
  // both sides' presence via `count`, so the UI can render `tokens`
  // as-is without re-aggregating step rows.
  tokens?: {
    input?: number
    output?: number
  }
}

export type EntityTimelineInboxRow = IncludesInboxMessage
export type EntityTimelineWakeRow = IncludesWakeMessage
export type EntityTimelineSignalRow = IncludesSignal
export type EntityTimelineErrorRow = EntityTimelineErrorItem & {
  order: TimelineOrder
}

export type EntityTimelineQueryRow =
  | {
      $key: string
      inbox: EntityTimelineInboxRow
      run?: undefined
      wake?: undefined
      signal?: undefined
      error?: undefined
      manifest?: undefined
    }
  | {
      $key: string
      inbox?: undefined
      run: EntityTimelineRunRow
      wake?: undefined
      signal?: undefined
      error?: undefined
      manifest?: undefined
    }
  | {
      $key: string
      inbox?: undefined
      run?: undefined
      wake: EntityTimelineWakeRow
      signal?: undefined
      error?: undefined
      manifest?: undefined
    }
  | {
      $key: string
      inbox?: undefined
      run?: undefined
      wake?: undefined
      signal: EntityTimelineSignalRow
      error?: undefined
      manifest?: undefined
    }
  | {
      $key: string
      inbox?: undefined
      run?: undefined
      wake?: undefined
      signal?: undefined
      error: EntityTimelineErrorRow
      manifest?: undefined
    }
  | {
      $key: string
      inbox?: undefined
      run?: undefined
      wake?: undefined
      signal?: undefined
      error?: undefined
      manifest: ManifestEntry
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
    signals: data.signals ?? [],
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
type SignalRow = OrderedValue<
  EntityStreamDB[`collections`][`signals`][`toArray`][number]
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

function readTimelineOrder(row: object): string | undefined {
  const order = Reflect.get(row, `_timeline_order`)
  return typeof order === `string` ? order : undefined
}

export function createPendingTimelineOrder(index: number): string {
  return `${TIMELINE_ORDER_FALLBACK}pending:${index.toString().padStart(12, `0`)}`
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
    __electricRowOffsets?: Map<string | number, EventPointer>
  },
  row: TRow,
  index: number
): string {
  const timelineOrder = readTimelineOrder(row)
  if (timelineOrder) {
    return timelineOrder
  }

  const pointer = collection.__electricRowOffsets?.get(row.key)
  if (pointer) {
    return formatPointerOrderToken(pointer)
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
    __electricRowOffsets?: Map<string | number, EventPointer>
  },
  row: TRow
): string | undefined {
  const timelineOrder = readTimelineOrder(row)
  if (timelineOrder) {
    return timelineOrder
  }

  const pointer = collection.__electricRowOffsets?.get(row.key)
  if (pointer) {
    return formatPointerOrderToken(pointer)
  }

  const inlineSeq = readInlineSeq(row)
  return inlineSeq === undefined ? undefined : toSeqOrderToken(inlineSeq)
}

function withOrderToken<TRow extends { key: string | number }>(collection: {
  id?: string
  toArray: Array<TRow>
  __electricRowOffsets?: Map<string | number, EventPointer>
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
  __electricRowOffsets?: Map<string | number, EventPointer>
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
        __electricRowOffsets?: Map<string | number, EventPointer>
      }
    | undefined,
  id: string
): {
  id?: string
  toArray: Array<TRow>
  __electricRowOffsets?: Map<string | number, EventPointer>
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
  // The order token is already a stable, sortable string representation
  // of an `EventPointer` (or a `_seq` / `pending` fallback). Round-trip
  // semantics are maintained as long as every callsite that produces
  // a historyOffset goes through the same formatter — see
  // `readContextHistoryOffset` in `context-factory.ts`.
  return orderToken
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
      input_tokens: step.input_tokens,
      output_tokens: step.output_tokens,
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

  return [...input.runs].sort(compareTimelineOrder).map((run) => {
    const runSteps = [...(stepsByRun.get(run.key) ?? [])].sort(
      (left, right) => left.step_number - right.step_number
    )
    const tokens = aggregateRunTokens(runSteps)
    return {
      key: run.key,
      order: run.order,
      status: run.status,
      finish_reason: run.finish_reason,
      texts: [...(textsByRun.get(run.key) ?? [])].sort(compareTimelineOrder),
      toolCalls: [...(toolCallsByRun.get(run.key) ?? [])].sort(
        compareTimelineOrder
      ),
      steps: runSteps,
      errors: [...(errorsByRun.get(run.key) ?? [])],
      ...(tokens && { tokens }),
    }
  })
}

/**
 * In-memory token aggregator used by `buildIncludesRuns` to match the
 * shape that `createEntityIncludesQuery` / `createEntityTimelineQuery`
 * produce via `sum` / `count` over the steps collection.
 *
 * Returns `undefined` when no step reported a token count on either
 * side, so the consumer can elide the meta row entirely instead of
 * showing "0 / 0" for runs whose provider never emitted usage data.
 */
function aggregateRunTokens(
  steps: ReadonlyArray<{ input_tokens?: number; output_tokens?: number }>
): { input?: number; output?: number } | undefined {
  let inSum = 0
  let outSum = 0
  let sawIn = false
  let sawOut = false
  for (const step of steps) {
    if (typeof step.input_tokens === `number`) {
      inSum += step.input_tokens
      sawIn = true
    }
    if (typeof step.output_tokens === `number`) {
      outSum += step.output_tokens
      sawOut = true
    }
  }
  if (!sawIn && !sawOut) return undefined
  return {
    ...(sawIn && { input: inSum }),
    ...(sawOut && { output: outSum }),
  }
}

function buildInboxMessages(
  inbox: Array<InboxRow>
): Array<IncludesInboxMessage> {
  return [...inbox].sort(compareTimelineOrder).map((message) => ({
    key: message.key,
    order: message.order,
    from: message.from ?? `unknown`,
    payload: message.payload,
    message_type: message.message_type,
    timestamp: message.timestamp ?? new Date(0).toISOString(),
    mode: message.mode ?? `immediate`,
    status: message.status ?? `processed`,
    position: message.position,
    processed_at: message.processed_at,
    cancelled_at: message.cancelled_at,
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

function buildSignalMessages(signals: Array<SignalRow>): Array<IncludesSignal> {
  return [...signals].sort(compareTimelineOrder).map((signal) => {
    const { _seq: _ignoredSeq, ...value } = signal
    return {
      ...value,
      order: signal.order,
    }
  })
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
  const signals = withOrderToken(db.collections.signals)
  const contextInserted = withOrderToken(
    getOrderableCollection<ContextInsertedValueRow>(
      db.collections.contextInserted as
        | {
            id?: string
            toArray: Array<ContextInsertedValueRow>
            __electricRowOffsets?: Map<string | number, EventPointer>
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
            __electricRowOffsets?: Map<string | number, EventPointer>
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
    signals,
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
    signals: buildSignalMessages(withOrderFromOrderIndex(signals, orderIndex)),
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
        mode: coalesce(inbox.mode, `immediate`),
        status: coalesce(inbox.status, `processed`),
        position: inbox.position,
        processed_at: inbox.processed_at,
        cancelled_at: inbox.cancelled_at,
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

const getEntitySignalsCollection = cachedCollectionFactory(
  (db: EntityStreamDB) =>
    createLiveQueryCollection({
      id: `${String(db.collections.signals.id)}:signals-live`,
      query: (q) =>
        q.from({ signal: db.collections.signals }).select(({ signal }) => ({
          timelineKey: TIMELINE_KEY,
          key: signal.key,
          order: coalesce(signal._seq, -1),
          signal: signal.signal,
          status: signal.status,
          sender: signal.sender,
          reason: signal.reason,
          payload: signal.payload,
          timestamp: signal.timestamp,
          handled_at: signal.handled_at,
          handled_by: signal.handled_by,
          outcome: signal.outcome,
          previous_state: signal.previous_state,
          new_state: signal.new_state,
        })),
    })
)

type EntityTimelineQueryBuilder = (q: InitialQueryBuilder) => QueryBuilder<any>

const indexedTimelineDbs = new WeakSet<object>()

type IndexableCollection = {
  createIndex: (
    index: (row: any) => unknown,
    config: { indexType: typeof BasicIndex }
  ) => void
}

function hasCreateIndex(value: unknown): value is IndexableCollection {
  return (
    !!value &&
    typeof (value as { createIndex?: unknown }).createIndex === `function`
  )
}

function createIndexIfAvailable(
  collection: unknown,
  index: (row: any) => unknown
): void {
  if (hasCreateIndex(collection)) {
    collection.createIndex(index, { indexType: BasicIndex })
  }
}

export function ensureEntityTimelineIndexes(db: EntityStreamDB): void {
  if (indexedTimelineDbs.has(db as object)) return
  indexedTimelineDbs.add(db as object)

  createIndexIfAvailable(db.collections.texts, (row) => row.run_id)
  createIndexIfAvailable(db.collections.textDeltas, (row) => row.text_id)
  createIndexIfAvailable(db.collections.toolCalls, (row) => row.run_id)
  createIndexIfAvailable(db.collections.reasoning, (row) => row.run_id)
  createIndexIfAvailable(
    db.collections.reasoningDeltas,
    (row) => row.reasoning_id
  )
  createIndexIfAvailable(db.collections.steps, (row) => row.run_id)
  createIndexIfAvailable(db.collections.errors, (row) => row.run_id)
}

/**
 * Builds a live timeline query for an entity stream.
 *
 * The returned query is a multi-source timeline ordered by each row's
 * `_timeline_order`. Each result row has TanStack DB's virtual `$key` plus one
 * populated source property:
 *
 * - `{ inbox }` for user inbox messages.
 * - `{ run }` for agent runs.
 * - `{ wake }` for wake events.
 * - `{ signal }` for entity signals.
 * - `{ manifest }` for manifest entries.
 *
 * Run rows include live child collections rather than materialized arrays:
 * `run.items`, `run.steps`, and `run.errors`. Pass those child collections to
 * `useLiveQuery` (or another live-query consumer) in child renderers to receive
 * fine-grained updates while text chunks stream in. Text run items expose their
 * concatenated streamed content as `item.text.content`.
 */
export function createEntityTimelineQuery(
  db: EntityStreamDB,
  opts: EntityTimelineQueryOptions = {}
): EntityTimelineQueryBuilder {
  ensureEntityTimelineIndexes(db)
  return (q: InitialQueryBuilder) => buildEntityTimelineQuery(q, db, opts)
}

function buildEntityTimelineQuery(
  q: InitialQueryBuilder,
  db: EntityStreamDB,
  opts: EntityTimelineQueryOptions
): QueryBuilder<any> {
  const inboxMode = opts.inboxMode ?? `processed`

  let inbox = q.from({ inbox: db.collections.inbox })
  if (inboxMode === `processed`) {
    inbox = inbox.where(({ inbox }) =>
      or(
        eq(coalesce(inbox.status, `processed`), `processed`),
        and(
          eq(inbox.$synced, false),
          eq(coalesce(inbox.status, `pending`), `pending`),
          like(coalesce(inbox._timeline_order, ``), `~pending:%`)
        )
      )
    )
  }

  const inboxSource = inbox.select(({ inbox }) => ({
    order: coalesce(inbox._timeline_order, `~`),
    key: inbox.key,
    from: coalesce(inbox.from, `unknown`),
    from_principal: inbox.from_principal,
    from_agent: inbox.from_agent,
    payload: inbox.payload,
    timestamp: coalesce(inbox.timestamp, ``),
    mode: coalesce(inbox.mode, `immediate`),
    status: coalesce(inbox.status, `processed`),
    position: inbox.position,
    processed_at: inbox.processed_at,
    cancelled_at: inbox.cancelled_at,
  }))

  const wakeSource = q
    .from({ wake: db.collections.wakes })
    .select(({ wake }) => ({
      key: wake.key,
      order: coalesce(wake._timeline_order, `~`),
      payload: {
        type: `wake` as const,
        timestamp: wake.timestamp,
        source: wake.source,
        timeout: wake.timeout,
        changes: wake.changes,
        finished_child: wake.finished_child,
        other_children: wake.other_children,
      },
    }))

  const signalSource = q
    .from({ signal: db.collections.signals })
    .select(({ signal }) => ({
      key: signal.key,
      order: coalesce(signal._timeline_order, `~`),
      signal: signal.signal,
      status: signal.status,
      sender: signal.sender,
      reason: signal.reason,
      payload: signal.payload,
      timestamp: signal.timestamp,
      handled_at: signal.handled_at,
      handled_by: signal.handled_by,
      outcome: signal.outcome,
      previous_state: signal.previous_state,
      new_state: signal.new_state,
    }))

  const errorSource = q
    .from({ error: db.collections.errors })
    .where(({ error }) => or(isNull(error.run_id), isUndefined(error.run_id)))
    .select(({ error }) => ({
      key: error.key,
      order: coalesce(error._timeline_order, `~`),
      error_code: error.error_code,
      message: error.message,
      run_id: error.run_id,
    }))

  const textFirstDeltaSource = q
    .from({ textDelta: db.collections.textDeltas })
    .groupBy(({ textDelta }) => textDelta.text_id)
    .select(({ textDelta }) => ({
      text_id: textDelta.text_id,
      order: min(coalesce(textDelta._seq, -1)),
    }))

  // Union texts + tool calls into a single ordered stream. The
  // text-delta join lives at this level (vs. inside the consumer's
  // `items.select`) so the correlation key is `text.key` — a field
  // on the raw text row — rather than a projected scalar. The only
  // delta-join alias constraint is that it must NOT collide with
  // the `chunk` alias used in the reasoning content sub-query
  // below; that's why this one is `textChunk`.
  const runItemsSource = q
    .unionAll({
      text: db.collections.texts,
      toolCall: db.collections.toolCalls,
    })
    .leftJoin({ firstDelta: textFirstDeltaSource }, ({ text, firstDelta }) =>
      eq(text.key, firstDelta.text_id)
    )
    .select(({ text, toolCall, firstDelta }) => ({
      order: coalesce(firstDelta.order, text._seq, toolCall._seq, -1),
      run_id: coalesce(text.run_id, toolCall.run_id, ``),
      text: caseWhen(text.key, {
        key: text.key,
        run_id: text.run_id,
        order: coalesce(firstDelta.order, text._seq, -1),
        status: text.status,
      }),
      textContent: concat(
        toArray(
          q
            .from({ textChunk: db.collections.textDeltas })
            .where(({ textChunk }) => eq(textChunk.text_id, text.key))
            .orderBy(({ textChunk }) => coalesce(textChunk._seq, -1))
            .select(({ textChunk }) => textChunk.delta)
        )
      ),
      toolCall: caseWhen(toolCall.key, {
        key: toolCall.key,
        run_id: toolCall.run_id,
        order: coalesce(toolCall._seq, -1),
        tool_call_id: toolCall.tool_call_id,
        tool_name: toolCall.tool_name,
        status: toolCall.status,
        args: toolCall.args,
        result: toolCall.result,
        error: toolCall.error,
      }),
    }))

  // Mirror `runItemsSource`'s shape for reasoning rows: the
  // `concat(toArray(...))` include is *defined* on this top-level
  // source, then the `reasoning:` consumer inside `runSource.select`
  // below dereferences it into `content: r.reasoningContent`. The
  // two-layer source/consumer split is load-bearing: `useLiveQuery`
  // reads of a sub-collection that has an include co-defined in the
  // same select return the row with `content: null` + a deferred
  // `Symbol(includesRouting)` marker. Naming the include field in a
  // downstream `.select` is what forces materialization — exactly
  // how `items.text.content` pulls `item.textContent` out of
  // `runItemsSource`. Alias is `reasoningChunk` to avoid colliding
  // with `textChunk` used above.
  const runReasoningSource = q
    .from({ reasoning: db.collections.reasoning })
    .select(({ reasoning }) => ({
      key: reasoning.key,
      run_id: reasoning.run_id,
      order: coalesce(reasoning._seq, -1),
      status: reasoning.status,
      summary_title: reasoning.summary_title,
      encrypted: reasoning.encrypted,
      reasoningContent: concat(
        toArray(
          q
            .from({ reasoningChunk: db.collections.reasoningDeltas })
            .where(({ reasoningChunk }) =>
              eq(reasoningChunk.reasoning_id, reasoning.key)
            )
            .orderBy(({ reasoningChunk }) => coalesce(reasoningChunk._seq, -1))
            .select(({ reasoningChunk }) => reasoningChunk.delta)
        )
      ),
    }))

  const runTokensSource = q
    .from({ step: db.collections.steps })
    .groupBy(({ step }) => step.run_id)
    .select(({ step }) => ({
      run_id: step.run_id,
      input: sum(coalesce(step.input_tokens, 0)),
      output: sum(coalesce(step.output_tokens, 0)),
      input_count: count(step.input_tokens),
      output_count: count(step.output_tokens),
    }))

  const runSource = q
    .from({ run: db.collections.runs })
    .leftJoin({ runTokens: runTokensSource }, ({ run, runTokens }) =>
      eq(run.key, runTokens.run_id)
    )
    .select(({ run, runTokens }) => ({
      key: run.key,
      order: coalesce(run._timeline_order, `~`),
      status: run.status,
      finish_reason: run.finish_reason,
      // Mirrors the `tokens` shape produced by `createEntityIncludesQuery`
      // so the UI can read `run.tokens` directly off the live row without
      // re-summing step contents.
      tokens: caseWhen(
        or(
          gt(coalesce(runTokens.input_count, 0), 0),
          gt(coalesce(runTokens.output_count, 0), 0)
        ),
        {
          input: caseWhen(
            gt(coalesce(runTokens.input_count, 0), 0),
            runTokens.input
          ),
          output: caseWhen(
            gt(coalesce(runTokens.output_count, 0), 0),
            runTokens.output
          ),
        }
      ),
      items: q
        .from({ item: runItemsSource })
        .where(({ item }) => eq(item.run_id, run.key))
        .orderBy(({ item }) => item.order)
        .orderBy(({ item }) =>
          coalesce(
            caseWhen(item.text.key, `text`),
            caseWhen(item.toolCall.key, `toolCall`),
            ``
          )
        )
        .orderBy(({ item }) => coalesce(item.text.key, item.toolCall.key, ``))
        .select(({ item }) => ({
          text: caseWhen(item.text.key, {
            key: item.text.key,
            run_id: item.text.run_id,
            order: item.text.order,
            status: item.text.status,
            content: item.textContent,
          }),
          toolCall: item.toolCall,
        })),
      reasoning: q
        .from({ r: runReasoningSource })
        .where(({ r }) => eq(r.run_id, run.key))
        .orderBy(({ r }) => r.order)
        .orderBy(({ r }) => r.key)
        .select(({ r }) => ({
          key: r.key,
          run_id: r.run_id,
          order: r.order,
          status: r.status,
          // Wrap the include reference inside a `caseWhen` object body
          // — the same construct items uses to materialize
          // `item.textContent` into `text.content`. Bare top-level
          // references leave the include deferred until UI reads it
          // through `useLiveQuery`, which never gets through. UI reads
          // `entry.body?.content` instead of `entry.content`.
          body: caseWhen(r.key, {
            content: r.reasoningContent,
          }),
          summary_title: r.summary_title,
          encrypted: r.encrypted,
        })),
      steps: q
        .from({ step: db.collections.steps })
        .where(({ step }) => eq(step.run_id, run.key))
        .orderBy(({ step }) => step.step_number)
        .orderBy(({ step }) => coalesce(step._timeline_order, `~`))
        .orderBy(({ step }) => step.key)
        .select(({ step }) => ({
          key: step.key,
          run_id: step.run_id,
          order: coalesce(step._timeline_order, `~`),
          step_number: step.step_number,
          status: step.status,
          model_id: step.model_id,
          duration_ms: step.duration_ms,
          input_tokens: step.input_tokens,
          output_tokens: step.output_tokens,
        })),
      errors: q
        .from({ error: db.collections.errors })
        .where(({ error }) => eq(error.run_id, run.key))
        .orderBy(({ error }) => error.key)
        .select(({ error }) => ({
          key: error.key,
          run_id: error.run_id,
          error_code: error.error_code,
          message: error.message,
        })),
    }))

  const sources: Record<string, any> = {
    inbox: inboxSource,
    run: runSource,
    wake: wakeSource,
    signal: signalSource,
    error: errorSource,
    manifest: db.collections.manifests,
  }
  for (const [name, buildSource] of Object.entries(opts.customSources ?? {})) {
    if (name in sources) {
      throw new Error(
        `customSources name "${name}" collides with a built-in timeline source`
      )
    }
    sources[name] = buildSource(q)
  }
  const sourceNames = Object.keys(sources)
  // The manifests collection joins the union raw, so its order lives on
  // `_timeline_order` rather than a projected `order` field.
  const orderRef = (refs: any, name: string) =>
    name === `manifest` ? refs.manifest._timeline_order : refs[name].order
  const coalesceAll = (exprs: Array<any>) =>
    coalesce(...(exprs as [any, ...Array<any>]))

  return q
    .unionAll(sources)
    .orderBy((refs: any) =>
      coalesceAll([
        ...sourceNames.map((name) => orderRef(refs, name)),
        TIMELINE_ORDER_FALLBACK,
      ])
    )
    .orderBy((refs: any) =>
      coalesceAll([
        ...sourceNames.map((name) => caseWhen(refs[name].key, name)),
        ``,
      ])
    )
    .orderBy((refs: any) =>
      coalesceAll([...sourceNames.map((name) => refs[name].key), ``])
    )
}

type EntityQueryBuilder = (q: InitialQueryBuilder) => QueryBuilder<any>

export function createEntityIncludesQuery(
  db: EntityStreamDB
): EntityQueryBuilder {
  ensureEntityTimelineIndexes(db)
  const seedCollection = getTimelineSeedCollection(db)
  const runsCollection = getEntityRunsCollection(db)
  const inboxCollection = getEntityInboxCollection(db)
  const wakesCollection = getEntityWakesCollection(db)
  const signalsCollection = getEntitySignalsCollection(db)
  const entitiesCollection = getEntityEntitiesCollection(db)

  return (q: InitialQueryBuilder) =>
    q.from({ timeline: seedCollection }).select(({ timeline }) => ({
      key: timeline.key,
      runs: toArray(
        q
          .from({ run: runsCollection })
          .leftJoin(
            {
              runTokens: q
                .from({ step: db.collections.steps })
                .groupBy(({ step }) => step.run_id)
                .select(({ step }) => ({
                  run_id: step.run_id,
                  input: sum(coalesce(step.input_tokens, 0)),
                  output: sum(coalesce(step.output_tokens, 0)),
                  input_count: count(step.input_tokens),
                  output_count: count(step.output_tokens),
                })),
            },
            ({ run, runTokens }) => eq(run.key, runTokens.run_id)
          )
          .where(({ run }) => eq(run.timelineKey, timeline.key))
          .orderBy(({ run }) => run.order)
          .select(({ run, runTokens }) => ({
            key: run.key,
            order: run.order,
            status: run.status,
            finish_reason: run.finish_reason,
            // Per-run token totals — `caseWhen` collapses the
            // joined aggregate row down to the same
            // `{ input?, output? } | undefined` shape consumers
            // expect, dropping a side whose `count` is zero so a
            // provider that only reported one side renders as
            // "input only" rather than "input + 0 output".
            tokens: caseWhen(
              or(
                gt(coalesce(runTokens.input_count, 0), 0),
                gt(coalesce(runTokens.output_count, 0), 0)
              ),
              {
                input: caseWhen(
                  gt(coalesce(runTokens.input_count, 0), 0),
                  runTokens.input
                ),
                output: caseWhen(
                  gt(coalesce(runTokens.output_count, 0), 0),
                  runTokens.output
                ),
              }
            ),
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
                  input_tokens: step.input_tokens,
                  output_tokens: step.output_tokens,
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
            mode: inbox.mode,
            status: inbox.status,
            position: inbox.position,
            processed_at: inbox.processed_at,
            cancelled_at: inbox.cancelled_at,
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
      signals: toArray(
        q
          .from({ signal: signalsCollection })
          .where(({ signal }) => eq(signal.timelineKey, timeline.key))
          .orderBy(({ signal }) => signal.order)
          .select(({ signal }) => ({
            key: signal.key,
            order: signal.order,
            signal: signal.signal,
            status: signal.status,
            sender: signal.sender,
            reason: signal.reason,
            payload: signal.payload,
            timestamp: signal.timestamp,
            handled_at: signal.handled_at,
            handled_by: signal.handled_by,
            outcome: signal.outcome,
            previous_state: signal.previous_state,
            new_state: signal.new_state,
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
      .where(({ errors }) =>
        or(isNull(errors.run_id), isUndefined(errors.run_id))
      )
      .select(({ errors }) => ({
        key: errors.key,
        error_code: errors.error_code,
        message: errors.message,
      }))
}
