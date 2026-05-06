import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  measureElement as defaultMeasureElement,
  useVirtualizer,
} from '@tanstack/react-virtual'
import { ArrowDown } from 'lucide-react'
import {
  loadTimelineRowHeights,
  persistTimelineRowHeights,
} from '../lib/timelineRowHeights'
import { usePaneFindAdapterRegistration } from '../hooks/usePaneFind'
import { warmMarkdownRenderCache } from '../lib/markdownRenderCache'
import { ScrollArea, Stack, Text, Tooltip } from '../ui'
import { UserMessage } from './UserMessage'
import { AgentResponse } from './AgentResponse'
import {
  getCurrentMatchIndexInRoot,
  getTextMatchStarts,
} from './workspace/PaneFindBar'
import {
  formatAbsoluteDateTimeVerbose,
  formatShortTime,
} from '../lib/formatTime'
import styles from './EntityTimeline.module.css'
import type { EntityTimelineEntry } from '@electric-ax/agents-runtime'
import type { PaneFindAdapter, PaneFindMatch } from '../hooks/usePaneFind'

/**
 * Width-aware row-height estimate used as the initial size hint for the
 * virtualizer (before the real DOM has been measured). Producing an estimate
 * that's close to the eventual measured height matters because the
 * virtualizer absolutely-positions rows based on these values: when the
 * estimate is wildly off, rows visually overlap or leave gaps for a frame
 * before `ResizeObserver` catches up.
 *
 * The previous heuristic ignored the column width and used a flat
 * ~0.12 px/char ratio, which only happened to be roughly right at one
 * specific column width and was noticeably wrong on resize / chat swap.
 * We now derive an approximate chars-per-line from the actual column
 * width and multiply by the body line height.
 */
function estimateRowHeight(
  row: EntityTimelineEntry | undefined,
  contentWidth: number
): number {
  if (!row) return 120

  // Inter at 14px averages ~7px per character; clamp to keep narrow
  // viewports / a yet-unknown contentWidth from producing nonsense values.
  const usableWidth = contentWidth > 0 ? contentWidth : 720
  const charsPerLine = Math.max(40, Math.floor(usableWidth / 7))
  const lineHeight = 22 // 14px font * ~1.55 leading

  if (row.section.kind === `user_message`) {
    const lines = Math.max(1, Math.ceil(row.section.text.length / charsPerLine))
    // bubble padding (24) + meta row (~24) + content
    return Math.max(64, 48 + lines * lineHeight)
  }

  const textLength = row.section.items.reduce((total: number, item) => {
    if (item.kind === `text`) return total + item.text.length
    // Tool calls render as a compact block; assume ~3 lines.
    return total + charsPerLine * 3
  }, 0)
  const lines = Math.max(2, Math.ceil(textLength / charsPerLine))
  // status row (~24) + content + a little breathing room
  return Math.max(120, 32 + lines * lineHeight)
}

const SCROLL_THRESHOLD = 80
const ROW_GAP = 24
const ROW_SETTLE_MS = 500

type TimelinePaneFindMatch = PaneFindMatch & {
  rowKey: string
  rowIndex: number
  rowOccurrence: number
}

function timelineRowSearchText(row: EntityTimelineEntry): string {
  const { section } = row
  if (section.kind === `user_message`) return section.text

  return section.items
    .map((item) => {
      if (item.kind === `text`) return item.text
      const parts = [
        item.toolName,
        JSON.stringify(item.args, null, 2),
        item.result ?? ``,
      ]
      return parts.filter((part) => part.trim().length > 0).join(`\n`)
    })
    .filter((part) => part.trim().length > 0)
    .join(`\n\n`)
}

function timelineRowLabel(row: EntityTimelineEntry): string {
  return row.section.kind === `user_message` ? `User message` : `Agent response`
}

function excerptAround(
  text: string,
  start: number,
  queryLength: number
): string {
  const context = 48
  const from = Math.max(0, start - context)
  const to = Math.min(text.length, start + queryLength + context)
  const prefix = from > 0 ? `...` : ``
  const suffix = to < text.length ? `...` : ``
  return `${prefix}${text.slice(from, to).replace(/\s+/g, ` `)}${suffix}`
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function isTimelineFindMatch(
  match: PaneFindMatch
): match is TimelinePaneFindMatch {
  return (
    typeof (match as TimelinePaneFindMatch).rowKey === `string` &&
    typeof (match as TimelinePaneFindMatch).rowIndex === `number`
  )
}

// `section` and `responseTimestamp` are pulled out of the parent
// `EntityTimelineEntry` so React.memo's shallow compare can hit on
// the *section* identity. `buildTimelineEntries` returns a fresh
// `entries` array (and fresh entry objects) on every chunk during
// streaming, but the runtime caches finished agent sections in a
// WeakMap keyed by the underlying run row — so unchanged rows
// receive the identical `section` reference each render. With the
// previous `row` prop, that hit was masked by the always-new wrapper
// object; splitting the props lets memo skip every settled row and
// only re-render the streaming row + the row that just settled.
const TimelineRow = memo(function TimelineRow({
  section,
  responseTimestamp,
  entityStopped,
  isStreaming,
  renderWidth,
}: {
  section: EntityTimelineEntry[`section`]
  responseTimestamp: EntityTimelineEntry[`responseTimestamp`]
  entityStopped: boolean
  isStreaming: boolean
  renderWidth: number
}): React.ReactElement {
  if (section.kind === `user_message`) {
    return <UserMessage section={section} />
  }

  return (
    <AgentResponse
      section={section}
      isStreaming={!entityStopped && isStreaming}
      timestamp={responseTimestamp}
      renderWidth={renderWidth}
    />
  )
})

export function EntityTimeline({
  entries,
  loading,
  error,
  entityStopped,
  cacheKey,
  tileId,
}: {
  entries: Array<EntityTimelineEntry>
  loading: boolean
  error: string | null
  entityStopped: boolean
  cacheKey?: string | null
  tileId?: string | null
}): React.ReactElement {
  const rows = useMemo(() => entries, [entries])
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(
    null
  )
  const [viewportWidth, setViewportWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const isNearBottom = useRef(true)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const cachedSizeMapRef = useRef(new Map<string, number>())
  const lastMeasureAtRef = useRef(new Map<string, number>())
  const settledKeysRef = useRef(new Set<string>())
  const settleCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const firstMessage = rows.find(
    (
      row
    ): row is EntityTimelineEntry & {
      section: Extract<EntityTimelineEntry[`section`], { kind: `user_message` }>
    } => row.section.kind === `user_message`
  )
  const spawnTime = firstMessage?.section.timestamp ?? null

  const lastStreamingAgentKey = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index]
      if (row.section.kind === `agent_response`) {
        return row.section.done ? null : row.key
      }
    }
    return null
  }, [rows])

  const persistSettledRows = useCallback(() => {
    if (!cacheKey || viewportWidth <= 0) return
    persistTimelineRowHeights(
      cacheKey,
      viewportWidth,
      cachedSizeMapRef.current,
      settledKeysRef.current
    )
  }, [cacheKey, viewportWidth])

  const scheduleSettleCheck = useCallback(() => {
    if (settleCheckTimerRef.current !== null) {
      clearTimeout(settleCheckTimerRef.current)
    }

    settleCheckTimerRef.current = setTimeout(() => {
      settleCheckTimerRef.current = null
      const now = Date.now()
      let anyNewlySettled = false

      for (const [key, lastMeasureAt] of lastMeasureAtRef.current) {
        if (settledKeysRef.current.has(key)) continue
        if (now - lastMeasureAt < ROW_SETTLE_MS) continue
        settledKeysRef.current.add(key)
        anyNewlySettled = true
      }

      if (anyNewlySettled) {
        persistSettledRows()
      }
    }, ROW_SETTLE_MS)
  }, [persistSettledRows])

  const measureRowElement = useCallback<
    NonNullable<
      Parameters<
        typeof useVirtualizer<HTMLDivElement, HTMLDivElement>
      >[0][`measureElement`]
    >
  >(
    (element, entry, instance) => {
      const itemKey = element.getAttribute(`data-item-key`)
      const domSize = defaultMeasureElement(element, entry, instance)

      // A real, non-zero measurement is the source of truth: cache it and
      // surface it to the virtualizer. A zero (e.g. element detached, not
      // yet laid out) must not poison the cache or replace a known good
      // size — fall back to whatever we already had.
      if (itemKey !== null && domSize > 0) {
        cachedSizeMapRef.current.set(itemKey, domSize)
        lastMeasureAtRef.current.set(itemKey, Date.now())
        settledKeysRef.current.delete(itemKey)
        scheduleSettleCheck()
        return domSize
      }

      if (itemKey !== null) {
        const cached = cachedSizeMapRef.current.get(itemKey)
        if (cached !== undefined && cached > 0) return cached
      }
      return domSize
    },
    [scheduleSettleCheck]
  )

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport,
    estimateSize: (index) =>
      cachedSizeMapRef.current.get(rows[index]?.key ?? ``) ??
      estimateRowHeight(rows[index], contentWidth),
    getItemKey: (index) => rows[index]?.key ?? index,
    gap: ROW_GAP,
    overscan: 6,
    measureElement: measureRowElement,
    enabled: rows.length > 0,
  })

  const paneFindAdapter = useMemo<PaneFindAdapter>(() => {
    const getHighlightRoot = (match: PaneFindMatch): HTMLElement | null => {
      if (!contentElement || !isTimelineFindMatch(match)) return null
      return contentElement.querySelector<HTMLElement>(
        `[data-pane-find-row-key="${CSS.escape(match.rowKey)}"]`
      )
    }

    return {
      search(query) {
        const matches: Array<TimelinePaneFindMatch> = []
        if (!query.trim()) return matches

        rows.forEach((row, rowIndex) => {
          const text = timelineRowSearchText(row)
          const starts = getTextMatchStarts(text, query)
          starts.forEach((start, rowOccurrence) => {
            matches.push({
              id: `${row.key}:${rowOccurrence}`,
              rowKey: row.key,
              rowIndex,
              rowOccurrence,
              label: timelineRowLabel(row),
              excerpt: excerptAround(text, start, query.length),
            })
          })
        })
        return matches
      },
      async reveal(match) {
        if (!isTimelineFindMatch(match)) return
        rowVirtualizer.scrollToIndex(match.rowIndex, { align: `center` })
        for (let i = 0; i < 8; i++) {
          await nextFrame()
          if (getHighlightRoot(match)) return
        }
      },
      getHighlightRoot,
      getCurrentMatchIndex(match, query) {
        if (!isTimelineFindMatch(match)) return 0
        const root = getHighlightRoot(match)
        if (!root) return 0
        return getCurrentMatchIndexInRoot(root, query, match)
      },
    }
  }, [contentElement, rowVirtualizer, rows])

  usePaneFindAdapterRegistration(tileId ?? null, paneFindAdapter)

  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false
  }, [rowVirtualizer])

  const scrollAreaRef = useCallback((node: HTMLDivElement | null) => {
    setViewport(node)
  }, [])

  const contentRef = useCallback((node: HTMLDivElement | null) => {
    setContentElement(node)
  }, [])

  useEffect(() => {
    void warmMarkdownRenderCache()
  }, [])

  useEffect(() => {
    if (!viewport) return

    const updateViewportWidth = () => {
      const w = Math.round(viewport.clientWidth)
      setViewportWidth((prev) => {
        if (prev !== w && prev > 0) {
          // Container resized (e.g. state explorer toggled, window resize) —
          // mark all rows as un-settled so we'll persist new heights once
          // ResizeObserver remeasures them at the new width. Crucially we
          // KEEP the prior heights as estimates so the virtualizer's
          // initial layout at the new width stays close to truth; rows
          // would otherwise visually overlap while they remeasure.
          settledKeysRef.current = new Set()
        }
        return w
      })
    }

    updateViewportWidth()
    const observer = new ResizeObserver(updateViewportWidth)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewport])

  useEffect(() => {
    if (!contentElement) return

    const updateContentWidth = () => {
      setContentWidth(Math.round(contentElement.clientWidth))
    }

    updateContentWidth()
    const observer = new ResizeObserver(updateContentWidth)
    observer.observe(contentElement)
    return () => observer.disconnect()
  }, [contentElement])

  // Track cacheKey/viewportWidth across renders so the effect below can tell
  // a chat swap apart from a width change. They have very different reset
  // semantics: a chat swap throws away all known row sizes (different
  // entries with different keys), while a width change wants to PRESERVE
  // the old heights as estimates so the layout stays put while
  // ResizeObserver remeasures at the new width.
  const prevCacheKeyRef = useRef<string | null | undefined>(undefined)
  const prevViewportWidthRef = useRef(0)

  useEffect(() => {
    const isChatSwap = prevCacheKeyRef.current !== cacheKey
    const widthChanged = prevViewportWidthRef.current !== viewportWidth
    prevCacheKeyRef.current = cacheKey
    prevViewportWidthRef.current = viewportWidth

    if (!cacheKey || viewportWidth <= 0) {
      if (isChatSwap) {
        cachedSizeMapRef.current = new Map()
        settledKeysRef.current = new Set()
        lastMeasureAtRef.current = new Map()
        rowVirtualizer.measure()
      }
      return
    }

    if (isChatSwap) {
      // Different chat → different row keys. Reload heights from
      // localStorage and invalidate the virtualizer's internal item-size
      // cache so it consults `estimateSize` for every new key.
      const restored = loadTimelineRowHeights(cacheKey, viewportWidth)
      cachedSizeMapRef.current = restored
      settledKeysRef.current = new Set(restored.keys())
      lastMeasureAtRef.current = new Map()
      rowVirtualizer.measure()
      return
    }

    if (widthChanged) {
      // Same chat, new viewport width. Pull in any heights we previously
      // persisted at this width as updated estimates, but DO NOT call
      // `rowVirtualizer.measure()` here: the existing rows are still
      // mounted and ResizeObserver will deliver fresh measurements as
      // they reflow. Calling `measure()` would throw away the
      // virtualizer's internal cache between ResizeObserver firing and
      // our re-render, producing the visible row-overlap glitch.
      const restored = loadTimelineRowHeights(cacheKey, viewportWidth)
      if (restored.size > 0) {
        for (const [key, size] of restored) {
          cachedSizeMapRef.current.set(key, size)
        }
        for (const key of restored.keys()) settledKeysRef.current.add(key)
      }
    }
  }, [cacheKey, rowVirtualizer, viewportWidth])

  useEffect(() => {
    if (!viewport) return

    const handleScroll = () => {
      const nearBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
        SCROLL_THRESHOLD
      isNearBottom.current = nearBottom
      setShowJumpToBottom(!nearBottom)
    }

    handleScroll()
    viewport.addEventListener(`scroll`, handleScroll, { passive: true })
    return () => viewport.removeEventListener(`scroll`, handleScroll)
  }, [viewport])

  useLayoutEffect(() => {
    if (!viewport || rows.length === 0) return
    if (!isNearBottom.current) return

    const frame = requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(rows.length - 1, { align: `end` })
    })

    return () => cancelAnimationFrame(frame)
  }, [rowVirtualizer, rows, viewport])

  useEffect(
    () => () => {
      if (settleCheckTimerRef.current !== null) {
        clearTimeout(settleCheckTimerRef.current)
      }
    },
    []
  )

  const jumpToBottom = useCallback(() => {
    if (rows.length > 0) {
      rowVirtualizer.scrollToIndex(rows.length - 1, { align: `end` })
    }
  }, [rowVirtualizer, rows.length])

  if (loading) {
    return (
      <Stack align="center" justify="center" grow>
        <Text tone="muted" size={2}>
          Connecting to stream...
        </Text>
      </Stack>
    )
  }

  if (error) {
    return (
      <Stack align="center" justify="center" grow>
        <Text tone="danger" size={2}>
          {error}
        </Text>
      </Stack>
    )
  }

  return (
    <div className={styles.root}>
      <ScrollArea
        viewportRef={scrollAreaRef}
        className={styles.scroll}
        viewportClassName={styles.scrollViewport}
        scrollbars="vertical"
      >
        <div ref={contentRef} className={styles.content}>
          <Stack>
            {spawnTime ? (
              <Tooltip content={formatAbsoluteDateTimeVerbose(spawnTime)}>
                <Text size={1} tone="muted" className={styles.statusPill}>
                  {`spawned · ${formatShortTime(spawnTime)}`}
                </Text>
              </Tooltip>
            ) : (
              <Text size={1} tone="muted" className={styles.statusPill}>
                spawned
              </Text>
            )}
          </Stack>

          {rows.length === 0 ? (
            <Stack justify="center" py={6}>
              <Text tone="muted" size={2} className={styles.emptyState}>
                Waiting for events...
              </Text>
            </Stack>
          ) : (
            <div
              className={styles.virtualList}
              style={{
                height: rowVirtualizer.getTotalSize(),
                marginTop: ROW_GAP,
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index]

                // Stable row key. The previous implementation appended
                // `:${contentWidth}` to force remount on every column-width
                // change, which paid for the workaround with a full
                // unmount/remount of every row (including a wasted Streamdown
                // render on initial mount when contentWidth went from 0 to
                // its real value). The new measurement-cache logic above
                // preserves prior heights as estimates and lets
                // ResizeObserver deliver new heights, so a remount is no
                // longer needed.
                return (
                  <div
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    data-item-key={row.key}
                    data-pane-find-row-key={row.key}
                    className={styles.virtualRow}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <TimelineRow
                      section={row.section}
                      responseTimestamp={row.responseTimestamp}
                      entityStopped={entityStopped}
                      isStreaming={row.key === lastStreamingAgentKey}
                      renderWidth={contentWidth}
                    />
                  </div>
                )
              })}
            </div>
          )}

          {entityStopped && (
            <Stack style={{ marginTop: ROW_GAP }}>
              <Text size={1} tone="muted" className={styles.statusPill}>
                stopped
              </Text>
            </Stack>
          )}
        </div>
      </ScrollArea>

      {showJumpToBottom && (
        <button
          type="button"
          className={styles.jumpToBottom}
          onClick={jumpToBottom}
          aria-label="Jump to latest"
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  )
}
