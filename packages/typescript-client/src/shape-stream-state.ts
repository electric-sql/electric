import { Offset, Schema } from './types'
import {
  OFFSET_QUERY_PARAM,
  SHAPE_HANDLE_QUERY_PARAM,
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  CACHE_BUSTER_QUERY_PARAM,
} from './constants'

export type ShapeStreamStateKind =
  | `initial`
  | `syncing`
  | `live`
  | `replaying`
  | `stale-retry`
  | `paused`
  | `error`

/**
 * Shared fields carried by all active (non-paused, non-error) states.
 */
export interface SharedStateFields {
  readonly handle?: string
  readonly offset: Offset
  readonly schema?: Schema
  readonly liveCacheBuster: string
  readonly lastSyncedAt?: number
}

type ResponseBaseInput = {
  status: number
  responseHandle: string | null
  responseOffset: Offset | null
  responseCursor: string | null
  responseSchema?: Schema
  expiredHandle?: string | null
  now: number
}

export type ResponseMetadataInput = ResponseBaseInput & {
  maxStaleCacheRetries: number
  createCacheBuster: () => string
}

export type ResponseMetadataTransition =
  | { action: `accepted`; state: ShapeStreamState }
  | { action: `ignored`; state: ShapeStreamState }
  | {
      action: `stale-retry`
      state: StaleRetryState
      exceededMaxRetries: boolean
    }

export interface MessageBatchInput {
  hasMessages: boolean
  hasUpToDateMessage: boolean
  isSse: boolean
  upToDateOffset?: Offset
  now: number
  currentCursor: string
}

export interface MessageBatchTransition {
  state: ShapeStreamState
  suppressBatch: boolean
  becameUpToDate: boolean
}

export interface SseCloseInput {
  connectionDuration: number
  wasAborted: boolean
  minConnectionDuration: number
  maxShortConnections: number
}

export interface SseCloseTransition {
  state: ShapeStreamState
  fellBackToLongPolling: boolean
  wasShortConnection: boolean
}

export interface UrlParamsContext {
  isSnapshotRequest: boolean
  canLongPoll: boolean
}

// ---------------------------------------------------------------------------
// Abstract base — shared by ALL states (including Paused/Error)
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all shape stream states.
 *
 * Each concrete state carries only its relevant fields — there is no shared
 * flat context bag. Transitions create new immutable state objects.
 *
 * `isUpToDate` is derived from state kind (only LiveState returns true).
 */
export abstract class ShapeStreamState {
  abstract readonly kind: ShapeStreamStateKind

  // --- Shared field getters (all states expose these) ---
  abstract get handle(): string | undefined
  abstract get offset(): Offset
  abstract get schema(): Schema | undefined
  abstract get liveCacheBuster(): string
  abstract get lastSyncedAt(): number | undefined

  // --- Derived booleans ---
  get isUpToDate(): boolean {
    return false
  }

  // --- Per-state field defaults ---
  get staleCacheBuster(): string | undefined {
    return undefined
  }
  get staleCacheRetryCount(): number {
    return 0
  }
  get sseFallbackToLongPolling(): boolean {
    return false
  }
  get consecutiveShortSseConnections(): number {
    return 0
  }
  get replayCursor(): string | undefined {
    return undefined
  }

  // --- Default no-op methods ---

  canEnterReplayMode(): boolean {
    return false
  }

  enterReplayMode(_cursor: string): ShapeStreamState {
    return this
  }

  shouldUseSse(_opts: {
    liveSseEnabled: boolean
    isRefreshing: boolean
    resumingFromPause: boolean
  }): boolean {
    return false
  }

  handleSseConnectionClosed(_input: SseCloseInput): SseCloseTransition {
    return {
      state: this,
      fellBackToLongPolling: false,
      wasShortConnection: false,
    }
  }

  // --- URL param application ---

  /** Adds state-specific query parameters to the fetch URL. */
  applyUrlParams(_url: URL, _context: UrlParamsContext): void {}

  // --- Default response/message handlers (Paused/Error never receive these) ---

  handleResponseMetadata(
    _input: ResponseMetadataInput
  ): ResponseMetadataTransition {
    return { action: `ignored`, state: this }
  }

  handleMessageBatch(_input: MessageBatchInput): MessageBatchTransition {
    return { state: this, suppressBatch: false, becameUpToDate: false }
  }

  // --- Universal transitions ---

  /** Returns a new state identical to this one but with the handle changed. */
  abstract withHandle(handle: string): ShapeStreamState

  pause(): PausedState {
    return new PausedState(this)
  }

  toErrorState(error: Error): ErrorState {
    return new ErrorState(this, error)
  }

  markMustRefetch(handle?: string): InitialState {
    return new InitialState({
      handle,
      offset: `-1`,
      liveCacheBuster: ``,
      lastSyncedAt: this.lastSyncedAt,
      schema: undefined,
    })
  }
}

// ---------------------------------------------------------------------------
// ActiveState — intermediate base for all non-paused, non-error states
// ---------------------------------------------------------------------------

/**
 * Holds shared field storage and provides helpers for response/message
 * handling. All five active states extend this (via FetchingState or directly).
 */
abstract class ActiveState extends ShapeStreamState {
  readonly #shared: SharedStateFields

  constructor(shared: SharedStateFields) {
    super()
    this.#shared = shared
  }

  get handle() {
    return this.#shared.handle
  }
  get offset() {
    return this.#shared.offset
  }
  get schema() {
    return this.#shared.schema
  }
  get liveCacheBuster() {
    return this.#shared.liveCacheBuster
  }
  get lastSyncedAt() {
    return this.#shared.lastSyncedAt
  }

  /** Expose shared fields to subclasses for spreading into new instances. */
  protected get currentFields(): SharedStateFields {
    return this.#shared
  }

  // --- URL param application ---

  applyUrlParams(url: URL, _context: UrlParamsContext): void {
    url.searchParams.set(OFFSET_QUERY_PARAM, this.#shared.offset)
    if (this.#shared.handle) {
      url.searchParams.set(SHAPE_HANDLE_QUERY_PARAM, this.#shared.handle)
    }
  }

  // --- Helpers for subclass handleResponseMetadata implementations ---

  /** Extracts updated SharedStateFields from response headers. */
  protected parseResponseFields(
    input: ResponseMetadataInput
  ): SharedStateFields {
    let handle = this.#shared.handle
    const responseHandle = input.responseHandle
    if (responseHandle && responseHandle !== input.expiredHandle) {
      handle = responseHandle
    }

    let offset = this.#shared.offset
    if (input.responseOffset) {
      offset = input.responseOffset
    }

    let liveCacheBuster = this.#shared.liveCacheBuster
    if (input.responseCursor) {
      liveCacheBuster = input.responseCursor
    }

    let schema = this.#shared.schema
    if (schema === undefined && input.responseSchema !== undefined) {
      schema = input.responseSchema
    }

    let lastSyncedAt = this.#shared.lastSyncedAt
    if (input.status === 204) {
      lastSyncedAt = input.now
    }

    return { handle, offset, schema, liveCacheBuster, lastSyncedAt }
  }

  /**
   * Stale detection. Returns a transition if the response is stale,
   * or null if it is not stale and the caller should proceed normally.
   */
  protected checkStaleResponse(
    input: ResponseMetadataInput
  ): ResponseMetadataTransition | null {
    const responseHandle = input.responseHandle
    const expiredHandle = input.expiredHandle

    if (!responseHandle || responseHandle !== expiredHandle) {
      return null // not stale
    }

    // Stale response detected
    if (this.#shared.handle === undefined) {
      // No local handle — enter stale retry
      const retryCount = this.staleCacheRetryCount + 1
      const staleRetryState = new StaleRetryState({
        handle: this.#shared.handle,
        offset: this.#shared.offset,
        schema: this.#shared.schema,
        liveCacheBuster: this.#shared.liveCacheBuster,
        lastSyncedAt: this.#shared.lastSyncedAt,
        staleCacheBuster: input.createCacheBuster(),
        staleCacheRetryCount: retryCount,
      })

      return {
        action: `stale-retry`,
        state: staleRetryState,
        exceededMaxRetries: retryCount > input.maxStaleCacheRetries,
      }
    }

    // We have a valid local handle — ignore this stale response
    return { action: `ignored`, state: this }
  }

  // --- handleMessageBatch: template method with onUpToDate override point ---

  handleMessageBatch(input: MessageBatchInput): MessageBatchTransition {
    if (!input.hasMessages) {
      return { state: this, suppressBatch: false, becameUpToDate: false }
    }

    if (!input.hasUpToDateMessage) {
      return { state: this, suppressBatch: false, becameUpToDate: false }
    }

    // Has up-to-date message — compute shared fields for the transition
    let offset = this.#shared.offset
    if (input.isSse && input.upToDateOffset) {
      offset = input.upToDateOffset
    }

    const shared: SharedStateFields = {
      handle: this.#shared.handle,
      offset,
      schema: this.#shared.schema,
      liveCacheBuster: this.#shared.liveCacheBuster,
      lastSyncedAt: input.now,
    }

    return this.onUpToDate(shared, input)
  }

  /** Override point for up-to-date handling. Default → LiveState. */
  protected onUpToDate(
    shared: SharedStateFields,
    _input: MessageBatchInput
  ): MessageBatchTransition {
    return {
      state: new LiveState(shared),
      suppressBatch: false,
      becameUpToDate: true,
    }
  }
}

// ---------------------------------------------------------------------------
// FetchingState — Common behavior for Initial/Syncing/StaleRetry
// ---------------------------------------------------------------------------

/**
 * Captures shared behavior of InitialState, SyncingState, StaleRetryState:
 * - handleResponseMetadata: stale check → parse fields → new SyncingState
 * - canEnterReplayMode → true
 * - enterReplayMode → new ReplayingState
 */
abstract class FetchingState extends ActiveState {
  handleResponseMetadata(
    input: ResponseMetadataInput
  ): ResponseMetadataTransition {
    const staleResult = this.checkStaleResponse(input)
    if (staleResult) return staleResult

    const shared = this.parseResponseFields(input)
    return { action: `accepted`, state: new SyncingState(shared) }
  }

  canEnterReplayMode(): boolean {
    return true
  }

  enterReplayMode(cursor: string): ReplayingState {
    return new ReplayingState({
      ...this.currentFields,
      replayCursor: cursor,
    })
  }
}

// ---------------------------------------------------------------------------
// Concrete states
// ---------------------------------------------------------------------------

export class InitialState extends FetchingState {
  readonly kind = `initial` as const

  constructor(shared: SharedStateFields) {
    super(shared)
  }

  withHandle(handle: string): InitialState {
    return new InitialState({ ...this.currentFields, handle })
  }
}

export class SyncingState extends FetchingState {
  readonly kind = `syncing` as const

  constructor(shared: SharedStateFields) {
    super(shared)
  }

  withHandle(handle: string): SyncingState {
    return new SyncingState({ ...this.currentFields, handle })
  }
}

export class StaleRetryState extends FetchingState {
  readonly kind = `stale-retry` as const
  readonly #staleCacheBuster: string
  readonly #staleCacheRetryCount: number

  constructor(
    fields: SharedStateFields & {
      staleCacheBuster: string
      staleCacheRetryCount: number
    }
  ) {
    super({
      handle: fields.handle,
      offset: fields.offset,
      schema: fields.schema,
      liveCacheBuster: fields.liveCacheBuster,
      lastSyncedAt: fields.lastSyncedAt,
    })
    this.#staleCacheBuster = fields.staleCacheBuster
    this.#staleCacheRetryCount = fields.staleCacheRetryCount
  }

  get staleCacheBuster() {
    return this.#staleCacheBuster
  }
  get staleCacheRetryCount() {
    return this.#staleCacheRetryCount
  }

  withHandle(handle: string): StaleRetryState {
    return new StaleRetryState({
      ...this.currentFields,
      handle,
      staleCacheBuster: this.#staleCacheBuster,
      staleCacheRetryCount: this.#staleCacheRetryCount,
    })
  }

  applyUrlParams(url: URL, context: UrlParamsContext): void {
    super.applyUrlParams(url, context)
    url.searchParams.set(CACHE_BUSTER_QUERY_PARAM, this.#staleCacheBuster)
  }
}

export class LiveState extends ActiveState {
  readonly kind = `live` as const
  readonly #consecutiveShortSseConnections: number
  readonly #sseFallbackToLongPolling: boolean

  constructor(
    shared: SharedStateFields,
    sseState?: {
      consecutiveShortSseConnections?: number
      sseFallbackToLongPolling?: boolean
    }
  ) {
    super(shared)
    this.#consecutiveShortSseConnections =
      sseState?.consecutiveShortSseConnections ?? 0
    this.#sseFallbackToLongPolling = sseState?.sseFallbackToLongPolling ?? false
  }

  get isUpToDate(): boolean {
    return true
  }

  get consecutiveShortSseConnections(): number {
    return this.#consecutiveShortSseConnections
  }

  get sseFallbackToLongPolling(): boolean {
    return this.#sseFallbackToLongPolling
  }

  withHandle(handle: string): LiveState {
    return new LiveState({ ...this.currentFields, handle }, this.sseState)
  }

  applyUrlParams(url: URL, context: UrlParamsContext): void {
    super.applyUrlParams(url, context)
    // Snapshot requests (with subsetParams) should never use live polling
    if (!context.isSnapshotRequest) {
      url.searchParams.set(LIVE_CACHE_BUSTER_QUERY_PARAM, this.liveCacheBuster)
      if (context.canLongPoll) {
        url.searchParams.set(LIVE_QUERY_PARAM, `true`)
      }
    }
  }

  private get sseState() {
    return {
      consecutiveShortSseConnections: this.#consecutiveShortSseConnections,
      sseFallbackToLongPolling: this.#sseFallbackToLongPolling,
    }
  }

  handleResponseMetadata(
    input: ResponseMetadataInput
  ): ResponseMetadataTransition {
    const staleResult = this.checkStaleResponse(input)
    if (staleResult) return staleResult

    const shared = this.parseResponseFields(input)
    return {
      action: `accepted`,
      state: new LiveState(shared, this.sseState),
    }
  }

  protected onUpToDate(
    shared: SharedStateFields,
    _input: MessageBatchInput
  ): MessageBatchTransition {
    return {
      state: new LiveState(shared, this.sseState),
      suppressBatch: false,
      becameUpToDate: true,
    }
  }

  shouldUseSse(opts: {
    liveSseEnabled: boolean
    isRefreshing: boolean
    resumingFromPause: boolean
  }): boolean {
    return (
      opts.liveSseEnabled &&
      !opts.isRefreshing &&
      !opts.resumingFromPause &&
      !this.#sseFallbackToLongPolling
    )
  }

  handleSseConnectionClosed(input: SseCloseInput): SseCloseTransition {
    let nextConsecutiveShort = this.#consecutiveShortSseConnections
    let nextFallback = this.#sseFallbackToLongPolling
    let fellBackToLongPolling = false
    let wasShortConnection = false

    if (
      input.connectionDuration < input.minConnectionDuration &&
      !input.wasAborted
    ) {
      wasShortConnection = true
      nextConsecutiveShort = nextConsecutiveShort + 1

      if (nextConsecutiveShort >= input.maxShortConnections) {
        nextFallback = true
        fellBackToLongPolling = true
      }
    } else if (input.connectionDuration >= input.minConnectionDuration) {
      nextConsecutiveShort = 0
    }

    return {
      state: new LiveState(this.currentFields, {
        consecutiveShortSseConnections: nextConsecutiveShort,
        sseFallbackToLongPolling: nextFallback,
      }),
      fellBackToLongPolling,
      wasShortConnection,
    }
  }
}

export class ReplayingState extends ActiveState {
  readonly kind = `replaying` as const
  readonly #replayCursor: string

  constructor(fields: SharedStateFields & { replayCursor: string }) {
    super({
      handle: fields.handle,
      offset: fields.offset,
      schema: fields.schema,
      liveCacheBuster: fields.liveCacheBuster,
      lastSyncedAt: fields.lastSyncedAt,
    })
    this.#replayCursor = fields.replayCursor
  }

  get replayCursor() {
    return this.#replayCursor
  }

  withHandle(handle: string): ReplayingState {
    return new ReplayingState({
      ...this.currentFields,
      handle,
      replayCursor: this.#replayCursor,
    })
  }

  handleResponseMetadata(
    input: ResponseMetadataInput
  ): ResponseMetadataTransition {
    const staleResult = this.checkStaleResponse(input)
    if (staleResult) return staleResult

    const shared = this.parseResponseFields(input)
    return {
      action: `accepted`,
      state: new ReplayingState({
        ...shared,
        replayCursor: this.#replayCursor,
      }),
    }
  }

  protected onUpToDate(
    shared: SharedStateFields,
    input: MessageBatchInput
  ): MessageBatchTransition {
    // If the cursor did not move since the previous session, this is still
    // replayed cache data. Suppress once and exit replay mode.
    if (!input.isSse && this.#replayCursor === input.currentCursor) {
      return {
        state: new LiveState(shared),
        suppressBatch: true,
        becameUpToDate: true,
      }
    }

    // Cursor moved — real data, transition to live normally
    return {
      state: new LiveState(shared),
      suppressBatch: false,
      becameUpToDate: true,
    }
  }
}

// ---------------------------------------------------------------------------
// Delegating states (Paused / Error)
// ---------------------------------------------------------------------------

export class PausedState extends ShapeStreamState {
  readonly kind = `paused` as const
  readonly previousState: ShapeStreamState

  constructor(previousState: ShapeStreamState) {
    super()
    this.previousState = previousState
  }

  get handle() {
    return this.previousState.handle
  }
  get offset() {
    return this.previousState.offset
  }
  get schema() {
    return this.previousState.schema
  }
  get liveCacheBuster() {
    return this.previousState.liveCacheBuster
  }
  get lastSyncedAt() {
    return this.previousState.lastSyncedAt
  }

  get isUpToDate(): boolean {
    return this.previousState.isUpToDate
  }

  get staleCacheBuster() {
    return this.previousState.staleCacheBuster
  }
  get staleCacheRetryCount() {
    return this.previousState.staleCacheRetryCount
  }
  get sseFallbackToLongPolling() {
    return this.previousState.sseFallbackToLongPolling
  }
  get consecutiveShortSseConnections() {
    return this.previousState.consecutiveShortSseConnections
  }
  get replayCursor() {
    return this.previousState.replayCursor
  }

  withHandle(handle: string): PausedState {
    return new PausedState(this.previousState.withHandle(handle))
  }

  applyUrlParams(url: URL, context: UrlParamsContext): void {
    this.previousState.applyUrlParams(url, context)
  }

  resume(): ShapeStreamState {
    return this.previousState
  }
}

export class ErrorState extends ShapeStreamState {
  readonly kind = `error` as const
  readonly previousState: ShapeStreamState
  readonly error: Error

  constructor(previousState: ShapeStreamState, error: Error) {
    super()
    this.previousState = previousState
    this.error = error
  }

  get handle() {
    return this.previousState.handle
  }
  get offset() {
    return this.previousState.offset
  }
  get schema() {
    return this.previousState.schema
  }
  get liveCacheBuster() {
    return this.previousState.liveCacheBuster
  }
  get lastSyncedAt() {
    return this.previousState.lastSyncedAt
  }

  get isUpToDate(): boolean {
    return this.previousState.isUpToDate
  }

  withHandle(handle: string): ErrorState {
    return new ErrorState(this.previousState.withHandle(handle), this.error)
  }

  applyUrlParams(url: URL, context: UrlParamsContext): void {
    this.previousState.applyUrlParams(url, context)
  }

  retry(): ShapeStreamState {
    return this.previousState
  }

  reset(handle?: string): InitialState {
    return this.previousState.markMustRefetch(handle)
  }
}

// ---------------------------------------------------------------------------
// Type alias & factory
// ---------------------------------------------------------------------------

export type ShapeStreamActiveState =
  | InitialState
  | SyncingState
  | LiveState
  | ReplayingState
  | StaleRetryState

export function createInitialState(opts: {
  offset: Offset
  handle?: string
}): InitialState {
  return new InitialState({
    handle: opts.handle,
    offset: opts.offset,
    liveCacheBuster: ``,
    lastSyncedAt: undefined,
    schema: undefined,
  })
}
