import { Check, Copy } from 'lucide-react'
import {
  memo,
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
import { TimeText } from './TimeText'
import { ThinkingIndicator } from './ThinkingIndicator'
import styles from './AgentResponse.module.css'
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

function errorText(errors: Array<EntityTimelineErrorItem>): string | undefined {
  return errors.length > 0
    ? errors
        .map((error) =>
          error.error_code
            ? `${error.error_code}: ${error.message}`
            : error.message
        )
        .join(`; `)
    : undefined
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
  onSearchTextChange,
}: {
  rowKey: string
  run: EntityTimelineRunRow
  isStreaming: boolean
  timestamp?: number | null
  renderWidth?: number
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
  const sortedItems = useMemo(
    () => [...items].sort(compareLiveRunItems),
    [items]
  )
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
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      {sortedItems.map((item, i) => {
        if (item.text) {
          return (
            <LiveTextItem
              key={item.$key}
              item={item.text}
              isStreaming={isStreaming && i === sortedItems.length - 1}
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
          />
        )
      })}

      <Stack align="center" gap={2} className={styles.metaRow}>
        {showThinking && <ThinkingIndicator />}
        {done && (
          <Text size={1} tone="muted" className={styles.doneText}>
            ✓ done
          </Text>
        )}
        {failureText && (
          <Text size={1} tone="danger">
            ✗ {failureText}
          </Text>
        )}
        {showTimestamp && (
          <>
            {hasLeadingMeta && (
              <Text size={1} tone="muted" className={styles.metaSeparator}>
                ·
              </Text>
            )}
            <TimeText ts={timestamp} className={styles.timeText} />
          </>
        )}
        {(done || failureText) && copyText && (
          <Tooltip content={copied ? `Copied!` : `Copy response`} side="top">
            <IconButton
              size={1}
              variant="ghost"
              tone="neutral"
              className={styles.copyButton}
              onClick={() => void copyResponseText()}
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
      </Stack>
    </Stack>
  )
})

export const AgentResponse = memo(function AgentResponse({
  section,
  isStreaming,
  timestamp,
  renderWidth = 0,
}: {
  section: AgentResponseSection
  isStreaming: boolean
  timestamp?: number | null
  renderWidth?: number
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

      <Stack align="center" gap={2} className={styles.metaRow}>
        {showThinking && <ThinkingIndicator />}
        {section.done && (
          <Text size={1} tone="muted" className={styles.doneText}>
            ✓ done
          </Text>
        )}
        {section.error && (
          <Text size={1} tone="danger">
            ✗ {section.error}
          </Text>
        )}
        {/* Timestamp only on a settled response — while the agent is
            still streaming we let `ThinkingIndicator` (or the
            streaming text itself) own the meta row so it doesn't sit
            inline with a timestamp that hasn't really happened yet. */}
        {showTimestamp && (
          <>
            {hasLeadingMeta && (
              <Text size={1} tone="muted" className={styles.metaSeparator}>
                ·
              </Text>
            )}
            <TimeText ts={timestamp} className={styles.timeText} />
          </>
        )}
        {section.done && copyText && (
          <Tooltip content={copied ? `Copied!` : `Copy response`} side="top">
            <IconButton
              size={1}
              variant="ghost"
              tone="neutral"
              className={styles.copyButton}
              onClick={() => void copyResponseText()}
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
        {section.done && copyText && (
          <button
            type="button"
            className={styles.copyButton}
            onClick={() => void copyResponseText()}
            aria-label="Copy response text"
            title={copied ? `Copied` : `Copy all response text`}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? `Copied` : `Copy`}</span>
          </button>
        )}
      </Stack>
    </Stack>
  )
})
