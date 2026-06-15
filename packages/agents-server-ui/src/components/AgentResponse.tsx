import {
  Check,
  CircleAlert,
  Copy,
  GitFork,
  LoaderCircle,
  Reply,
} from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { Streamdown } from 'streamdown'
import {
  getCachedMarkdownRender,
  hashMarkdownContent,
  isMarkdownRenderCacheReady,
  setCachedMarkdownRender,
  warmMarkdownRenderCache,
} from '../lib/markdownRenderCache'
import {
  streamdownComponents,
  streamdownControls,
  streamdownPlugins,
} from '../lib/streamdownConfig'
import { Icon, IconButton, Stack, Text, Tooltip } from '../ui'
import { ToolCallView } from './ToolCallView'
import { InlineEventCard } from './InlineEventCard'
import { TimeText } from './TimeText'
import { ThinkingIndicator } from './ThinkingIndicator'
import { ElapsedTime } from './ElapsedTime'
import { ReasoningBlock, type ReasoningEntry } from './ReasoningSection'
import { TokenUsage } from './TokenUsage'

import { formatElapsedDuration, toMillis } from '../lib/formatTime'
import { singleFlight } from '../lib/singleFlight'
import styles from './AgentResponse.module.css'
import toolBlock from './toolBlock.module.css'
import type { ForkFromHereAction } from './UserMessage'
import type {
  EntityTimelineContentItem,
  EntityTimelineRunRow,
  EntityTimelineRunItem,
  EntityTimelineTextItem,
  EntityTimelineToolCallItem,
  EntityTimelineSection,
} from '@electric-ax/agents-runtime/client'

type EntityTimelineErrorItem = EntityTimelineRunRow[`errors`][`toArray`][number]

type AgentResponseSection = Extract<
  EntityTimelineSection,
  { kind: `agent_response` }
>

const SHIKI_SETTLE_MS = 80

function compareTimelineOrderValues(
  left: string | number,
  right: string | number
): number {
  if (typeof left === `number` && typeof right === `number`) {
    return left - right
  }
  return String(left).localeCompare(String(right))
}

const MarkdownSegment = memo(function MarkdownSegment({
  text,
  contentHash,
  isStreaming,
  renderWidth,
  canCache,
}: {
  text: string
  contentHash: number
  isStreaming: boolean
  renderWidth: number
  canCache: boolean
}): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const cachedHtmlHashRef = useRef<number | null>(null)
  // Tracks the content hash that the currently-displayed `cachedHtml`
  // belongs to, so we can distinguish "the underlying text changed and our
  // cached HTML is now stale" from "only the column width changed and our
  // cached HTML is still semantically correct, just laid out for a
  // different width".
  const [cachedHtml, setCachedHtmlState] = useState<string | null>(() => {
    if (!canCache || !isMarkdownRenderCacheReady() || renderWidth <= 0)
      return null
    const hit = getCachedMarkdownRender(contentHash, renderWidth, text)
    if (!hit) return null
    cachedHtmlHashRef.current = contentHash
    return hit.html
  })

  const setCachedHtml = (next: string | null, hash: number | null) => {
    cachedHtmlHashRef.current = next === null ? null : hash
    setCachedHtmlState(next)
  }

  useEffect(() => {
    if (!canCache) {
      setCachedHtml(null, null)
      return
    }

    const cached =
      renderWidth > 0
        ? getCachedMarkdownRender(contentHash, renderWidth, text)
        : null
    if (cached) {
      setCachedHtml(cached.html, contentHash)
      return
    }

    // Cache miss at the requested width.
    //
    // - If the displayed `cachedHtml` belongs to a DIFFERENT content hash
    //   (e.g. the agent message text was replaced after streaming ended,
    //   or this row was reused for a different segment), drop it
    //   immediately so we render the new content via Streamdown.
    //
    // - If it belongs to the SAME content hash, KEEP showing it: the
    //   cached HTML is just static markup and reflows correctly at any
    //   width. Dropping back to a live Streamdown render here would
    //   briefly clear the row and produce a visible flicker plus a
    //   row-height jump that the virtualizer has to chase.
    if (cachedHtmlHashRef.current !== contentHash) {
      setCachedHtml(null, null)
    }

    let cancelled = false
    void warmMarkdownRenderCache().then(() => {
      if (cancelled) return
      const resolvedWidth =
        renderWidth > 0
          ? renderWidth
          : Math.round(wrapperRef.current?.getBoundingClientRect().width ?? 0)
      if (resolvedWidth <= 0) return
      const hit = getCachedMarkdownRender(contentHash, resolvedWidth, text)
      if (hit) setCachedHtml(hit.html, contentHash)
    })

    return () => {
      cancelled = true
    }
  }, [canCache, contentHash, renderWidth, text])

  useLayoutEffect(() => {
    if (!canCache || cachedHtml !== null) return

    const element = wrapperRef.current
    if (!element) return

    let settledTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    const capture = () => {
      if (disposed) return
      const html = element.innerHTML
      const rect = element.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)

      if (html.length === 0 || width <= 0 || height <= 0) return
      setCachedMarkdownRender(contentHash, {
        html,
        width,
        height,
        sourceText: text,
      })
    }

    const scheduleCapture = () => {
      if (settledTimer !== null) {
        clearTimeout(settledTimer)
      }
      settledTimer = setTimeout(capture, SHIKI_SETTLE_MS)
    }

    const observer = new MutationObserver(scheduleCapture)
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
    scheduleCapture()

    return () => {
      disposed = true
      observer.disconnect()
      if (settledTimer !== null) {
        clearTimeout(settledTimer)
      }
    }
  }, [cachedHtml, canCache, contentHash, text])

  // When we are displaying previously cached HTML at a width that itself
  // has no cache entry yet (e.g. the column resized after we cached at
  // an earlier width), re-persist the same HTML keyed by the new
  // measured width so subsequent lookups at this width hit immediately
  // and we never have to drop back to a live Streamdown re-render.
  useLayoutEffect(() => {
    if (!canCache) return
    if (cachedHtml === null) return

    const element = wrapperRef.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    if (width <= 0 || height <= 0) return

    if (getCachedMarkdownRender(contentHash, width, text)) return
    setCachedMarkdownRender(contentHash, {
      html: cachedHtml,
      width,
      height,
      sourceText: text,
    })
  }, [cachedHtml, canCache, contentHash, renderWidth, text])

  if (cachedHtml !== null) {
    return (
      <div
        ref={wrapperRef}
        className={`agent-ui-markdown ${styles.markdown}`}
        dangerouslySetInnerHTML={{ __html: cachedHtml }}
      />
    )
  }

  return (
    <div ref={wrapperRef} className={`agent-ui-markdown ${styles.markdown}`}>
      <Streamdown
        isAnimating={isStreaming}
        plugins={streamdownPlugins}
        linkSafety={{ enabled: false }}
        controls={streamdownControls}
        components={streamdownComponents}
      >
        {text}
      </Streamdown>
    </div>
  )
})

function toolItemToCopyText(item: EntityTimelineContentItem): string {
  if (item.kind === `text`) return item.text

  const parts = [`[tool: ${item.toolName}]`]
  const argsText = JSON.stringify(item.args, null, 2)
  if (argsText && argsText !== `{}`) parts.push(argsText)
  if (item.result) parts.push(item.result)
  return parts.join(`\n`)
}

function stringifyToolPayload(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === `string`) return value
  return JSON.stringify(value)
}

function textContent(item: EntityTimelineTextItem | null | undefined): string {
  return typeof item?.content === `string` ? item.content : ``
}

function liveToolCallToContentItem(
  item: EntityTimelineToolCallItem
): Extract<EntityTimelineContentItem, { kind: `tool_call` }> {
  return {
    kind: `tool_call`,
    toolCallId: item.tool_call_id ?? item.key,
    toolName: item.tool_name,
    args:
      item.args && typeof item.args === `object`
        ? (item.args as Record<string, unknown>)
        : {},
    status: item.status,
    result: stringifyToolPayload(item.result),
    error: typeof item.error === `string` ? item.error : undefined,
    isError: item.status === `failed` || Boolean(item.error),
  }
}

function runItemKind(item: EntityTimelineRunItem): `text` | `toolCall` {
  return item.text ? `text` : `toolCall`
}

function runItemKey(item: EntityTimelineRunItem): string {
  return item.text?.key ?? item.toolCall?.key ?? ``
}

function compareLiveRunItems(
  left: EntityTimelineRunItem,
  right: EntityTimelineRunItem
): number {
  const orderCompare = compareTimelineOrderValues(
    left.text?.order ?? left.toolCall?.order ?? `~`,
    right.text?.order ?? right.toolCall?.order ?? `~`
  )
  if (orderCompare !== 0) return orderCompare

  const kindCompare = runItemKind(left).localeCompare(runItemKind(right))
  if (kindCompare !== 0) return kindCompare

  return runItemKey(left).localeCompare(runItemKey(right))
}

/**
 * One renderable element of a live run — either a text/tool-call item
 * or a reasoning block — tagged with its stream order so the two
 * streams can be interleaved at the positions they were emitted
 * (think → write → call tool → think → write …).
 */
type LiveRenderEntry =
  | {
      kind: `item`
      key: string
      order: string | number
      item: EntityTimelineRunItem
    }
  | {
      kind: `reasoning`
      key: string
      order: string | number
      reasoning: ReasoningEntry
    }

function compareLiveRenderEntries(
  left: LiveRenderEntry,
  right: LiveRenderEntry
): number {
  const orderCompare = compareTimelineOrderValues(left.order, right.order)
  if (orderCompare !== 0) return orderCompare
  if (left.kind === `item` && right.kind === `item`) {
    return compareLiveRunItems(left.item, right.item)
  }
  // At equal order, reasoning precedes output — the model thinks,
  // then writes. Mostly matters for legacy rows that predate
  // `_timeline_order` and all coalesce to the same sentinel.
  if (left.kind !== right.kind) return left.kind === `reasoning` ? -1 : 1
  return left.key.localeCompare(right.key)
}

function liveRunItemsToContentItems(
  items: Array<EntityTimelineRunItem>
): Array<EntityTimelineContentItem> {
  const contentItems: Array<EntityTimelineContentItem> = []
  for (const item of items) {
    if (item.text) {
      const content = textContent(item.text)
      if (content.trim().length > 0) {
        contentItems.push({ kind: `text`, text: content })
      }
      continue
    }
    if (!item.toolCall) {
      console.error(`Run item has neither text nor toolCall`, { item })
      continue
    }
    contentItems.push(liveToolCallToContentItem(item.toolCall))
  }
  return contentItems
}

function formatError(error: EntityTimelineErrorItem): string {
  return error.error_code
    ? `${error.error_code}: ${error.message}`
    : error.message
}

function errorText(errors: Array<EntityTimelineErrorItem>): string | undefined {
  return errors.length > 0 ? errors.map(formatError).join(`; `) : undefined
}

const RUN_ERROR_SUMMARY_LENGTH = 180

function isLongRunError(message: string): boolean {
  return message.length > RUN_ERROR_SUMMARY_LENGTH || message.includes(`\n`)
}

function runErrorSummary(message: string): string {
  const normalized = message.replace(/\s+/g, ` `)
  return normalized.length > RUN_ERROR_SUMMARY_LENGTH
    ? `${normalized.slice(0, RUN_ERROR_SUMMARY_LENGTH)}…`
    : normalized
}

function RunErrorInline({ message }: { message: string }): React.ReactElement {
  return (
    <Text size={1} tone="danger" truncate>
      ✗ {message}
    </Text>
  )
}

function RunErrorCard({ message }: { message: string }): React.ReactElement {
  return (
    <InlineEventCard
      icon={CircleAlert}
      title="run error"
      summary={runErrorSummary(message)}
      defaultExpanded={false}
      headerSurface
    >
      <pre className={toolBlock.codeBlock}>{message}</pre>
    </InlineEventCard>
  )
}

function failedRunText(
  run: EntityTimelineRunRow,
  items: Array<EntityTimelineRunItem>
): string | undefined {
  if (run.status !== `failed`) return undefined

  const failedTool = items.find(
    (item) =>
      item.toolCall?.status === `failed` &&
      typeof item.toolCall.error === `string` &&
      item.toolCall.error.trim().length > 0
  )?.toolCall
  if (failedTool) {
    return `${failedTool.tool_name} failed: ${failedTool.error}`
  }

  if (run.finish_reason) {
    return `Run failed (finish_reason=${run.finish_reason})`
  }

  return `Run failed (no error details recorded)`
}

const LiveTextItem = memo(function LiveTextItem({
  item,
  isStreaming,
  renderWidth,
}: {
  item: EntityTimelineTextItem
  isStreaming: boolean
  renderWidth: number
}): React.ReactElement {
  return (
    <MarkdownSegment
      text={textContent(item)}
      contentHash={0}
      isStreaming={isStreaming}
      renderWidth={renderWidth}
      canCache={false}
    />
  )
})

export const AgentResponseLive = memo(function AgentResponseLive({
  rowKey,
  run,
  isStreaming,
  timestamp,
  renderWidth = 0,
  forkFromHere,
  onReply,
  onReplyToToolCall,
  onSearchTextChange,
}: {
  rowKey: string
  run: EntityTimelineRunRow
  isStreaming: boolean
  timestamp?: number | null
  renderWidth?: number
  forkFromHere?: ForkFromHereAction
  onReply?: () => void
  onReplyToToolCall?: (item: EntityTimelineToolCallItem) => void
  onSearchTextChange?: (rowKey: string, text: string) => void
}): React.ReactElement {
  const { data: items = [] } = useLiveQuery(
    (q) => (run.items ? q.from({ item: run.items }) : undefined),
    [run.items]
  )
  const { data: errors = [] } = useLiveQuery(
    (q) => (run.errors ? q.from({ error: run.errors }) : undefined),
    [run.errors]
  )
  // Subscribe to the run's reasoning rows so the section ticks as
  // each `reasoning_delta` arrives. Empty array for runs without
  // any reasoning content (most non-extended-thinking models).
  const { data: reasoningRows = [] } = useLiveQuery(
    (q) => (run.reasoning ? q.from({ reasoning: run.reasoning }) : undefined),
    [run.reasoning]
  )
  const reasoningEntries = useMemo<Array<ReasoningEntry>>(
    () =>
      (
        reasoningRows as Array<{
          key: string
          status: `streaming` | `completed`
          body?: { content?: string }
          summary_title?: string
          encrypted?: string
          order?: string | number
        }>
      )
        .map<ReasoningEntry>((row) => ({
          key: row.key,
          order: row.order ?? `~`,
          status: row.status,
          summary_title: row.summary_title,
          encrypted: row.encrypted,
          // The projection in `entity-timeline.ts` wraps content under
          // `body` (inside a caseWhen) to force include materialization.
          // See the comment there.
          content: row.body?.content ?? ``,
        }))
        // Drop rows with nothing to show. The bridge opens a reasoning
        // row on `thinking_start` even when no delta ever arrives —
        // some providers (e.g. OpenAI codex models) report that the
        // model reasoned but never expose the tokens — and an empty
        // "Thought" block is pure noise. Encrypted rows stay: they're
        // Anthropic redacted thinking, rendered as a placeholder. A
        // row that is still streaming appears as soon as its first
        // delta lands.
        .filter((entry) => entry.content.trim().length > 0 || entry.encrypted),
    [reasoningRows]
  )
  // Token totals are aggregated in the query layer
  // (`createEntityTimelineQuery`) — see the `runTokensSource`
  // leftJoin in `entity-timeline.ts`. The query sums each step's
  // `input_tokens` / `output_tokens` and surfaces a single
  // `{ input?, output? } | undefined` row that updates at step
  // boundaries (the LLM SDK only emits `usage` at end-of-step). We
  // coerce `null` (TanStack DB's "no value" for a side whose
  // `count` was zero) to `undefined` so `TokenUsage` can use a
  // single `!= null` check.
  const liveTokens = useMemo(() => {
    if (!run.tokens) return null
    const input = run.tokens.input ?? undefined
    const output = run.tokens.output ?? undefined
    if (input === undefined && output === undefined) return null
    return { input, output }
  }, [run.tokens])

  const sortedItems = useMemo(
    () => [...items].sort(compareLiveRunItems),
    [items]
  )
  // Interleave reasoning blocks with the run's items by stream order
  // so each block renders where the model emitted it — before the
  // step's text / tool calls, not lumped above the whole response.
  const renderEntries = useMemo<Array<LiveRenderEntry>>(
    () =>
      [
        ...sortedItems.map<LiveRenderEntry>((item) => ({
          kind: `item`,
          key: item.$key,
          order: item.text?.order ?? item.toolCall?.order ?? `~`,
          item,
        })),
        ...reasoningEntries.map<LiveRenderEntry>((reasoning) => ({
          kind: `reasoning`,
          key: reasoning.key,
          order: reasoning.order,
          reasoning,
        })),
      ].sort(compareLiveRenderEntries),
    [sortedItems, reasoningEntries]
  )
  // Expand/collapse state for settled reasoning blocks, keyed by row
  // key. Owned here rather than inside `ReasoningBlock` so the user's
  // choice survives the block being unmounted and remounted — e.g.
  // when the reasoning row briefly disappears from the live query
  // while another part of the run updates, or when a virtualizer
  // measurement pass replaces the subtree.
  const [expandedReasoning, setExpandedReasoning] = useState<
    Record<string, boolean>
  >({})
  const toggleReasoning = useCallback((key: string) => {
    setExpandedReasoning((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])
  const contentItems = useMemo(
    () => liveRunItemsToContentItems(sortedItems),
    [sortedItems]
  )
  const copyText = useMemo(
    () =>
      contentItems
        .map(toolItemToCopyText)
        .filter((text) => text.trim().length > 0)
        .join(`\n\n`),
    [contentItems]
  )
  const searchText = useMemo(() => copyText, [copyText])
  useEffect(() => {
    onSearchTextChange?.(rowKey, searchText)
    return () => onSearchTextChange?.(rowKey, ``)
  }, [onSearchTextChange, rowKey, searchText])

  const done = run.status === `completed`
  const failureText =
    errorText(errors as Array<EntityTimelineErrorItem>) ??
    failedRunText(run, sortedItems)
  const lastItem = sortedItems[sortedItems.length - 1]
  const lastTextHasContent =
    lastItem?.text !== undefined && textContent(lastItem.text).trim().length > 0
  const showThinking =
    isStreaming && !done && !failureText && !lastTextHasContent
  const showTimestamp = timestamp != null && !isStreaming
  const hasLeadingMeta = showThinking || done || Boolean(failureText)
  const showCopyAction = Boolean((done || failureText) && copyText)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // "Done in Xs" closure cue. We only know the real run duration for
  // responses that finished WHILE this component instance was mounted
  // — `sawStreamingRef` records whether we ever observed an
  // in-flight state, and we snapshot `Date.now() - timestamp` at the
  // first frame where the run reports completion. For runs that were
  // already `completed` on initial mount (historical scrollback,
  // session reopen, hard reload mid-conversation) we don't have a
  // reliable end time on the client — `timestamp` here is the user
  // message time, not the completion time, so subtracting `now()`
  // would lie about the duration. In that case we keep the bare
  // `✓ done` label rather than print a wrong number.
  const sawStreamingRef = useRef<boolean>(isStreaming)
  if (isStreaming) sawStreamingRef.current = true
  const [finalDurationMs, setFinalDurationMs] = useState<number | null>(null)
  useEffect(() => {
    if (
      done &&
      sawStreamingRef.current &&
      timestamp != null &&
      finalDurationMs == null
    ) {
      setFinalDurationMs(Math.max(0, Date.now() - toMillis(timestamp)))
    }
  }, [done, timestamp, finalDurationMs])

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const copyResponseText = async () => {
    if (!copyText) return
    await navigator.clipboard.writeText(copyText)
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Stack direction="column" gap={2} className={styles.root}>
      {renderEntries.map((entry) => {
        if (entry.kind === `reasoning`) {
          return (
            <ReasoningBlock
              key={entry.key}
              entry={entry.reasoning}
              isStreaming={isStreaming}
              timestamp={timestamp}
              expanded={Boolean(expandedReasoning[entry.key])}
              onToggle={toggleReasoning}
            />
          )
        }

        const item = entry.item
        if (item.text) {
          return (
            <LiveTextItem
              key={item.$key}
              item={item.text}
              isStreaming={isStreaming && item === lastItem}
              renderWidth={renderWidth}
            />
          )
        }

        if (!item.toolCall) {
          console.error(`Run item has neither text nor toolCall`, { item })
          return null
        }

        return (
          <ToolCallView
            key={item.$key}
            item={liveToolCallToContentItem(item.toolCall)}
            onReply={
              onReplyToToolCall
                ? () => onReplyToToolCall(item.toolCall!)
                : undefined
            }
          />
        )
      })}

      {failureText && isLongRunError(failureText) && (
        <RunErrorCard message={failureText} />
      )}

      <Stack align="center" gap={2} className={styles.metaRow}>
        {showThinking && <ThinkingIndicator />}
        {done && (
          <Text size={1} tone="muted" className={styles.doneText}>
            {finalDurationMs != null
              ? `✓ done in ${formatElapsedDuration(finalDurationMs)}`
              : `✓ done`}
          </Text>
        )}
        {failureText && !isLongRunError(failureText) && (
          <RunErrorInline message={failureText} />
        )}
        {/* Elapsed-time ticker — visible while the response is still
            in flight so the user can see how long the model has been
            working ("Thinking · 12s", or just "12s" once tokens are
            streaming). Anchored to the same `timestamp` we'd display
            statically post-stream, so the timer's zero point matches
            the eventual settled-state timestamp. */}
        {isStreaming && timestamp != null && (
          <>
            {showThinking && (
              <Text size={1} tone="muted" className={styles.metaSeparator}>
                ·
              </Text>
            )}
            <ElapsedTime ts={timestamp} enabled={isStreaming} />
          </>
        )}
        {/* Token usage — sums every step's `input_tokens` /
            `output_tokens` as they land. Updates at step boundaries
            (the LLM SDK only emits `usage` at end-of-step), so for a
            single-turn call it appears once at done; for tool-using
            runs it jumps as each step completes. */}
        {liveTokens && (
          <>
            {(hasLeadingMeta || (isStreaming && timestamp != null)) && (
              <Text size={1} tone="muted" className={styles.metaSeparator}>
                ·
              </Text>
            )}
            <TokenUsage input={liveTokens.input} output={liveTokens.output} />
          </>
        )}
        {showTimestamp && (
          <>
            {(hasLeadingMeta || liveTokens) && (
              <Text size={1} tone="muted" className={styles.metaSeparator}>
                ·
              </Text>
            )}
            <TimeText ts={timestamp} className={styles.timeText} />
          </>
        )}
        <ResponseMetaActions
          showCopy={showCopyAction}
          copied={copied}
          onCopy={() => void copyResponseText()}
          forkFromHere={done ? forkFromHere : undefined}
          onReply={onReply}
        />
      </Stack>
    </Stack>
  )
})

function ResponseMetaActions({
  showCopy,
  copied,
  onCopy,
  forkFromHere,
  onReply,
}: {
  showCopy: boolean
  copied: boolean
  onCopy: () => void
  forkFromHere?: ForkFromHereAction
  onReply?: () => void
}): React.ReactElement | null {
  const showFork = forkFromHere !== undefined

  // Single-flight + spinner so repeat taps don't spawn duplicate forks.
  const [forking, setForking] = useState(false)
  const onForkRef = useRef(forkFromHere?.onFork)
  onForkRef.current = forkFromHere?.onFork
  const mountedRef = useRef(true)
  useEffect(() => () => void (mountedRef.current = false), [])
  const forkFlight = useMemo(
    () =>
      singleFlight(
        () => onForkRef.current?.(),
        (pending) => {
          if (mountedRef.current) setForking(pending)
        }
      ),
    []
  )

  if (!showCopy && !showFork && !onReply) return null

  const forkDisabled = forkFromHere?.disabled === true || !forkFromHere?.onFork
  const forkLabel = forking
    ? `Forking…`
    : forkDisabled
      ? `Fork permission required`
      : `Fork from here`

  return (
    <span className={styles.metaActions}>
      {onReply && (
        <Tooltip content="Reply" side="top">
          <IconButton
            size={1}
            variant="ghost"
            tone="neutral"
            className={styles.metaActionButton}
            onClick={onReply}
            aria-label="Reply to response"
            title="Reply"
          >
            <Icon icon={Reply} size={1} />
          </IconButton>
        </Tooltip>
      )}
      {showFork && (
        <Tooltip content={forkLabel} side="top">
          <span className={styles.tooltipTrigger}>
            <IconButton
              size={1}
              variant="ghost"
              tone="neutral"
              className={styles.metaActionButton}
              disabled={forkDisabled || forking}
              onClick={forkFlight.invoke}
              aria-label="Fork from here"
              title={forkLabel}
            >
              <Icon
                icon={forking ? LoaderCircle : GitFork}
                size={1}
                className={forking ? styles.spin : undefined}
              />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {showCopy && (
        <Tooltip content={copied ? `Copied!` : `Copy response`} side="top">
          <IconButton
            size={1}
            variant="ghost"
            tone="neutral"
            className={styles.metaActionButton}
            onClick={onCopy}
            aria-label="Copy response text"
          >
            {copied ? (
              <Icon icon={Check} size={1} />
            ) : (
              <Icon icon={Copy} size={1} />
            )}
          </IconButton>
        </Tooltip>
      )}
    </span>
  )
}

export const AgentResponse = memo(function AgentResponse({
  section,
  isStreaming,
  timestamp,
  renderWidth = 0,
  forkFromHere,
  onReply,
}: {
  section: AgentResponseSection
  isStreaming: boolean
  timestamp?: number | null
  renderWidth?: number
  forkFromHere?: ForkFromHereAction
  onReply?: () => void
}): React.ReactElement {
  const canCache = !isStreaming && section.done === true
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyText = useMemo(
    () =>
      section.items
        .map(toolItemToCopyText)
        .filter((text) => text.trim().length > 0)
        .join(`\n\n`),
    [section.items]
  )

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const copyResponseText = async () => {
    if (!copyText) return
    await navigator.clipboard.writeText(copyText)
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1200)
  }

  // "Thinking" indicator visibility:
  //   show while the response is mid-stream and there's nothing
  //   visibly being typed right now — i.e. before the first item
  //   appears, between a tool call and the next text chunk, or
  //   while a tool call is executing. We hide it as soon as the
  //   last item is a text chunk with actual content (the streaming
  //   text itself is the "still working" signal in that case).
  const lastItem = section.items[section.items.length - 1]
  const lastTextHasContent =
    lastItem?.kind === `text` && lastItem.text.trim().length > 0
  const showThinking =
    isStreaming && !section.done && !section.error && !lastTextHasContent
  const showTimestamp = timestamp != null && !isStreaming
  const hasLeadingMeta = showThinking || section.done || Boolean(section.error)
  const showCopyAction = Boolean(section.done && copyText)

  // Mirror of the `sawStreamingRef` / `finalDurationMs` capture from
  // `AgentResponseLive` — see the comment there for why we only
  // surface a duration when we actually witnessed streaming→done.
  const sawStreamingRef = useRef<boolean>(isStreaming)
  if (isStreaming) sawStreamingRef.current = true
  const [finalDurationMs, setFinalDurationMs] = useState<number | null>(null)
  useEffect(() => {
    if (
      section.done &&
      sawStreamingRef.current &&
      timestamp != null &&
      finalDurationMs == null
    ) {
      setFinalDurationMs(Math.max(0, Date.now() - toMillis(timestamp)))
    }
  }, [section.done, timestamp, finalDurationMs])

  return (
    <Stack direction="column" gap={2} className={styles.root}>
      {section.items.map((item: EntityTimelineContentItem, i: number) => {
        if (item.kind === `text`) {
          const isLastText = isStreaming && i === section.items.length - 1
          const contentHash = canCache ? hashMarkdownContent(item.text) : 0
          return (
            <MarkdownSegment
              key={`text-${i}`}
              text={item.text}
              contentHash={contentHash}
              isStreaming={isLastText}
              renderWidth={renderWidth}
              canCache={canCache}
            />
          )
        }

        return <ToolCallView key={item.toolCallId} item={item} />
      })}

      {section.error && isLongRunError(section.error) && (
        <RunErrorCard message={section.error} />
      )}

      <Stack align="center" gap={2} className={styles.metaRow}>
        {showThinking && <ThinkingIndicator />}
        {section.done && (
          <Text size={1} tone="muted" className={styles.doneText}>
            {finalDurationMs != null
              ? `✓ done in ${formatElapsedDuration(finalDurationMs)}`
              : `✓ done`}
          </Text>
        )}
        {section.error && !isLongRunError(section.error) && (
          <RunErrorInline message={section.error} />
        )}
        {/* Elapsed-time ticker — kept in sync with the live variant
            above so cached sections (rare during streaming, but the
            type permits it) render the same meta row. */}
        {isStreaming && timestamp != null && (
          <>
            {showThinking && (
              <Text size={1} tone="muted" className={styles.metaSeparator}>
                ·
              </Text>
            )}
            <ElapsedTime ts={timestamp} enabled={isStreaming} />
          </>
        )}
        {/* Token usage — `section.tokens` is the sum across the
            run's steps, materialized at section-build time. Mirrors
            the live render above so cached + live look identical. */}
        {section.tokens && (
          <>
            {(hasLeadingMeta || (isStreaming && timestamp != null)) && (
              <Text size={1} tone="muted" className={styles.metaSeparator}>
                ·
              </Text>
            )}
            <TokenUsage
              input={section.tokens.input}
              output={section.tokens.output}
            />
          </>
        )}
        {/* Timestamp only on a settled response — while the agent is
            still streaming we let `ThinkingIndicator` + `ElapsedTime`
            own the meta row so it doesn't sit inline with a timestamp
            that hasn't really happened yet. */}
        {showTimestamp && (
          <>
            {(hasLeadingMeta || section.tokens) && (
              <Text size={1} tone="muted" className={styles.metaSeparator}>
                ·
              </Text>
            )}
            <TimeText ts={timestamp} className={styles.timeText} />
          </>
        )}
        <ResponseMetaActions
          showCopy={showCopyAction}
          copied={copied}
          onCopy={() => void copyResponseText()}
          forkFromHere={section.done ? forkFromHere : undefined}
          onReply={onReply}
        />
      </Stack>
    </Stack>
  )
})
