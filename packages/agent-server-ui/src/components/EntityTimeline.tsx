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
import { Flex, ScrollArea, Text } from '@radix-ui/themes'
import {
  loadTimelineRowHeights,
  persistTimelineRowHeights,
} from '../lib/timelineRowHeights'
import { warmMarkdownRenderCache } from '../lib/markdownRenderCache'
import { UserMessage } from './UserMessage'
import { AgentResponse } from './AgentResponse'
import type { EntityTimelineEntry } from '@electric-ax/agent-runtime'

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: `2-digit`,
    minute: `2-digit`,
  })
}

function estimateRowHeight(row: EntityTimelineEntry | undefined): number {
  if (!row) return 120
  if (row.section.kind === `user_message`) {
    return Math.max(84, 44 + row.section.text.length * 0.18)
  }

  const textLength = row.section.items.reduce((total: number, item) => {
    if (item.kind === `text`) return total + item.text.length
    return total + 48
  }, 0)

  return Math.max(140, 72 + textLength * 0.12)
}

const SCROLL_THRESHOLD = 80
const ROW_GAP = 24
const ROW_SETTLE_MS = 500

const statusPillStyle = {
  padding: `4px 14px`,
  borderRadius: 12,
  opacity: 0.5,
  letterSpacing: `0.02em`,
} as const

const TimelineRow = memo(function TimelineRow({
  row,
  entityStopped,
  isStreaming,
  renderWidth,
}: {
  row: EntityTimelineEntry
  entityStopped: boolean
  isStreaming: boolean
  renderWidth: number
}): React.ReactElement {
  if (row.section.kind === `user_message`) {
    return <UserMessage section={row.section} />
  }

  return (
    <AgentResponse
      section={row.section}
      isStreaming={!entityStopped && isStreaming}
      timestamp={row.responseTimestamp}
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
}: {
  entries: Array<EntityTimelineEntry>
  loading: boolean
  error: string | null
  entityStopped: boolean
  cacheKey?: string | null
}): React.ReactElement {
  const rows = useMemo(() => entries, [entries])
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(
    null
  )
  const [viewportWidth, setViewportWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const isNearBottom = useRef(true)
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

      if (entry === undefined) {
        if (itemKey !== null) {
          const cached = cachedSizeMapRef.current.get(itemKey)
          if (cached !== undefined && cached > 0) {
            return cached
          }
        }

        const initialDomSize = defaultMeasureElement(element, entry, instance)
        if (itemKey !== null && initialDomSize > 0) {
          cachedSizeMapRef.current.set(itemKey, initialDomSize)
          lastMeasureAtRef.current.set(itemKey, Date.now())
          settledKeysRef.current.delete(itemKey)
          scheduleSettleCheck()
        }
        return initialDomSize
      }

      const domSize = defaultMeasureElement(element, entry, instance)
      if (itemKey !== null && domSize > 0) {
        cachedSizeMapRef.current.set(itemKey, domSize)
        lastMeasureAtRef.current.set(itemKey, Date.now())
        settledKeysRef.current.delete(itemKey)
        scheduleSettleCheck()
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
      estimateRowHeight(rows[index]),
    getItemKey: (index) => rows[index]?.key ?? index,
    gap: ROW_GAP,
    overscan: 6,
    measureElement: measureRowElement,
    enabled: rows.length > 0,
  })

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
      setViewportWidth(Math.round(viewport.clientWidth))
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

  useEffect(() => {
    if (!cacheKey || viewportWidth <= 0) {
      cachedSizeMapRef.current = new Map()
      settledKeysRef.current = new Set()
      rowVirtualizer.measure()
      return
    }

    const restored = loadTimelineRowHeights(cacheKey, viewportWidth)
    cachedSizeMapRef.current = restored
    settledKeysRef.current = new Set(restored.keys())
    lastMeasureAtRef.current = new Map()
    rowVirtualizer.measure()
  }, [cacheKey, rowVirtualizer, viewportWidth])

  useEffect(() => {
    if (!viewport) return

    const handleScroll = () => {
      isNearBottom.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
        SCROLL_THRESHOLD
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

  if (loading) {
    return (
      <Flex align="center" justify="center" flexGrow="1">
        <Text color="gray" size="2">
          Connecting to stream...
        </Text>
      </Flex>
    )
  }

  if (error) {
    return (
      <Flex align="center" justify="center" flexGrow="1">
        <Text color="red" size="2">
          {error}
        </Text>
      </Flex>
    )
  }

  return (
    <ScrollArea ref={scrollAreaRef} style={{ flex: 1 }}>
      <div
        ref={contentRef}
        style={{
          padding: `32px 40px`,
          maxWidth: `72ch`,
          margin: `0 auto`,
          overflowAnchor: `none`,
        }}
      >
        <Flex justify="center">
          <Text size="1" color="gray" style={statusPillStyle}>
            spawned{spawnTime ? ` · ${formatTime(spawnTime)}` : ``}
          </Text>
        </Flex>

        {rows.length === 0 ? (
          <Flex justify="center" py="6">
            <Text color="gray" size="2" style={{ opacity: 0.5 }}>
              Waiting for events...
            </Text>
          </Flex>
        ) : (
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: `relative`,
              marginTop: ROW_GAP,
              overflowAnchor: `none`,
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]

              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  data-item-key={row.key}
                  style={{
                    position: `absolute`,
                    top: 0,
                    left: 0,
                    width: `100%`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <TimelineRow
                    row={row}
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
          <Flex justify="center" style={{ marginTop: ROW_GAP }}>
            <Text size="1" color="gray" style={statusPillStyle}>
              stopped
            </Text>
          </Flex>
        )}
      </div>
    </ScrollArea>
  )
}
