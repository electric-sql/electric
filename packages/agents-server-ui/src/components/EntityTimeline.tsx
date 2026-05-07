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
import {
  ArrowDown,
  Database,
  ExternalLink,
  FileJson,
  GitBranch,
  Radio,
} from 'lucide-react'
import {
  loadTimelineRowHeights,
  persistTimelineRowHeights,
} from '../lib/timelineRowHeights'
import { usePaneFindAdapterRegistration } from '../hooks/usePaneFind'
import { useWorkspace } from '../hooks/useWorkspace'
import { warmMarkdownRenderCache } from '../lib/markdownRenderCache'
import { Icon, IconButton, ScrollArea, Stack, Text, Tooltip } from '../ui'
import { UserMessage } from './UserMessage'
import { AgentResponse } from './AgentResponse'
import { InlineEventCard } from './InlineEventCard'
import {
  getCurrentMatchIndexInRoot,
  getTextMatchStarts,
} from './workspace/PaneFindBar'
import {
  formatAbsoluteDateTimeVerbose,
  formatChatTimestamp,
} from '../lib/formatTime'
import styles from './EntityTimeline.module.css'
import type { Manifest } from '@electric-ax/agents-runtime'
import type { TimelineEntry } from '../lib/timelineEntries'
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
  row: TimelineEntry | undefined,
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
    return Math.max(64, 48 + lines * lineHeight) + timelineRowGap(row)
  }
  if (row.section.kind === `wake`) {
    return 28 + timelineRowGap(row)
  }
  if (row.section.kind === `manifest`) {
    return 76 + timelineRowGap(row)
  }

  const textLength = row.section.items.reduce((total: number, item) => {
    if (item.kind === `text`) return total + item.text.length
    // Tool calls render as a compact block; assume ~3 lines.
    return total + charsPerLine * 3
  }, 0)
  const lines = Math.max(2, Math.ceil(textLength / charsPerLine))
  // status row (~24) + content + a little breathing room
  return Math.max(120, 32 + lines * lineHeight) + timelineRowGap(row)
}

const BOTTOM_PIN_THRESHOLD = 8
const ROW_GAP = 24
const MANIFEST_ROW_GAP = 10
const ROW_SETTLE_MS = 500

function timelineRowGap(row: TimelineEntry): number {
  return row.section.kind === `manifest` ? MANIFEST_ROW_GAP : ROW_GAP
}

type TimelinePaneFindMatch = PaneFindMatch & {
  rowKey: string
  rowIndex: number
  rowOccurrence: number
}

function timelineRowSearchText(row: TimelineEntry): string {
  const { section } = row
  if (section.kind === `user_message`) return section.text
  if (section.kind === `wake`) return wakeSectionText(section)
  if (section.kind === `manifest`) return manifestSearchText(section.manifest)

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

function timelineRowLabel(row: TimelineEntry): string {
  switch (row.section.kind) {
    case `user_message`:
      return `User message`
    case `wake`:
      return `Wake`
    case `manifest`:
      return `Manifest item`
    case `agent_response`:
      return `Agent response`
  }
}

function wakeReason(
  section: Extract<TimelineEntry[`section`], { kind: `wake` }>
): string {
  const { payload } = section
  if (payload.timeout) return `timeout`
  if (payload.finished_child) {
    return `child ${payload.finished_child.run_status}`
  }
  if (payload.changes.length > 0) {
    return `${payload.changes.length} ${payload.changes.length === 1 ? `change` : `changes`}`
  }
  if (payload.other_children && payload.other_children.length > 0) {
    return `${payload.other_children.length} child ${payload.other_children.length === 1 ? `update` : `updates`}`
  }
  return payload.source
}

function wakeSectionText(
  section: Extract<TimelineEntry[`section`], { kind: `wake` }>
): string {
  return [`woke`, wakeReason(section), section.payload.source].join(` `)
}

function WakeTimelineRow({
  section,
}: {
  section: Extract<TimelineEntry[`section`], { kind: `wake` }>
}): React.ReactElement {
  const reason = wakeReason(section)
  return (
    <Tooltip content={formatAbsoluteDateTimeVerbose(section.timestamp)}>
      <span className={styles.statusPill}>
        <Text size={1} tone="muted" className={styles.statusText}>
          woke
        </Text>
        <Text size={1} tone="muted" className={styles.statusText}>
          ·
        </Text>
        <Text size={1} tone="muted" className={styles.statusText}>
          {reason}
        </Text>
        <Text size={1} tone="muted" className={styles.statusText}>
          ·
        </Text>
        <Text size={1} tone="muted" className={styles.statusText}>
          {formatChatTimestamp(section.timestamp)}
        </Text>
      </span>
    </Tooltip>
  )
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

function ManifestTimelineRow({
  manifest,
  entityUrl,
}: {
  manifest: Manifest
  entityUrl: string | null
  tileId: string | null
}): React.ReactElement {
  const { helpers } = useWorkspace()
  const entityTarget = getManifestEntityUrl(manifest)
  const stateSourceId = getManifestStateSourceId(manifest)
  const isEntity = entityTarget !== null
  const title = manifestTitle(manifest)
  const meta = manifestMeta(manifest)
  const summary =
    isEntity || stateSourceId ? null : [title, meta].filter(Boolean).join(` · `)

  const openEntity = useCallback(() => {
    if (!entityTarget) return
    helpers.openEntity(entityTarget)
  }, [entityTarget, helpers])

  const openStateInspector = useCallback(() => {
    if (!entityUrl || !stateSourceId) return
    helpers.openEntity(entityUrl, {
      viewId: `state-explorer`,
      viewParams: { source: stateSourceId },
    })
  }, [entityUrl, helpers, stateSourceId])

  const actions = stateSourceId ? (
    <Tooltip content="Open State Explorer">
      <IconButton
        type="button"
        size={1}
        variant="ghost"
        tone="neutral"
        className={styles.manifestActionButton}
        aria-label="Open State Explorer"
        onClick={openStateInspector}
        disabled={!entityUrl}
      >
        <Icon icon={ExternalLink} size={1} />
      </IconButton>
    </Tooltip>
  ) : entityTarget ? (
    <Tooltip content="Open entity">
      <IconButton
        type="button"
        size={1}
        variant="ghost"
        tone="neutral"
        className={styles.manifestActionButton}
        aria-label="Open entity"
        onClick={openEntity}
      >
        <Icon icon={ExternalLink} size={1} />
      </IconButton>
    </Tooltip>
  ) : undefined

  const details = <ManifestDetailGrid manifest={manifest} />

  return (
    <div className={styles.manifestRow}>
      <InlineEventCard
        icon={manifestIcon(manifest)}
        title={manifestKindLabel(manifest)}
        summary={summary}
        actions={actions}
        collapsible={!isEntity && !stateSourceId}
        headerSurface
      >
        {isEntity || stateSourceId ? (
          details
        ) : (
          <>
            {details}
            <pre className={styles.manifestJson}>
              {JSON.stringify(manifest, null, 2)}
            </pre>
          </>
        )}
      </InlineEventCard>
    </div>
  )
}

function ManifestDetailGrid({
  manifest,
}: {
  manifest: Manifest
}): React.ReactElement | null {
  const details = manifestDetails(manifest)
  if (details.length === 0) return null
  return (
    <div className={styles.manifestDetails}>
      {details.map((detail) => (
        <div key={detail.label} className={styles.manifestDetail}>
          <span>{detail.label}</span>
          <strong>{detail.value}</strong>
        </div>
      ))}
    </div>
  )
}

function manifestSearchText(manifest: Manifest): string {
  return [
    manifestKindLabel(manifest),
    manifestTitle(manifest),
    manifestMeta(manifest),
  ]
    .filter(Boolean)
    .join(` `)
}

function manifestKindLabel(manifest: Manifest): string {
  switch (manifest.kind) {
    case `child`:
      return `Child entity`
    case `source`:
      return manifest.sourceType === `db`
        ? `Database source`
        : `${titleCase(manifest.sourceType)} source`
    case `shared-state`:
      return `Shared state`
    case `effect`:
      return `Effect`
    case `context`:
      return `Context`
    case `schedule`:
      return `Schedule`
  }
}

function manifestTitle(manifest: Manifest): string {
  switch (manifest.kind) {
    case `child`:
      return manifest.id
    case `source`:
      return manifest.sourceRef
    case `shared-state`:
    case `effect`:
    case `context`:
    case `schedule`:
      return manifest.id
  }
}

function manifestMeta(manifest: Manifest): string {
  switch (manifest.kind) {
    case `child`:
      return `${manifest.entity_type}${manifest.observed ? `` : ` · unobserved`}`
    case `source`:
      return describeSourceConfig(manifest.config)
    case `shared-state`:
      return `${manifest.mode} · ${Object.keys(manifest.collections).join(`, `)}`
    case `effect`:
      return manifest.function_ref
    case `context`:
      return `${Object.keys(manifest.attrs).length} attrs`
    case `schedule`:
      return manifest.scheduleType === `cron`
        ? `${manifest.expression}${manifest.timezone ? ` · ${manifest.timezone}` : ``}`
        : `${manifest.fireAt} · ${manifest.status}`
  }
}

function manifestDetails(
  manifest: Manifest
): Array<{ label: string; value: string }> {
  switch (manifest.kind) {
    case `child`:
      return [
        { label: `Id`, value: manifest.id },
        { label: `Type`, value: manifest.entity_type },
      ]
    case `shared-state`:
      return [
        { label: `Mode`, value: manifest.mode },
        {
          label: `Collections`,
          value: Object.keys(manifest.collections).join(`, `) || `none`,
        },
      ]
    case `source`:
      return [
        { label: `Type`, value: manifest.sourceType },
        { label: `Ref`, value: manifest.sourceRef },
      ]
    case `effect`:
      return [
        { label: `Function`, value: manifest.function_ref },
        { label: `Config`, value: shortJson(manifest.config) },
      ]
    case `context`:
      return [
        { label: `Name`, value: manifest.name },
        { label: `Content`, value: `${manifest.content.length} chars` },
      ]
    case `schedule`:
      return manifest.scheduleType === `cron`
        ? [
            { label: `Cron`, value: manifest.expression },
            { label: `Timezone`, value: manifest.timezone ?? `local` },
          ]
        : [
            { label: `Fire at`, value: manifest.fireAt },
            { label: `Target`, value: manifest.targetUrl },
            { label: `Status`, value: manifest.status ?? `pending` },
          ]
    case `child`:
      return []
  }
}

function manifestIcon(manifest: Manifest) {
  if (getManifestStateSourceId(manifest)) return Database
  if (getManifestEntityUrl(manifest)) return GitBranch
  if (manifest.kind === `schedule`) return Radio
  return FileJson
}

function getManifestEntityUrl(manifest: Manifest): string | null {
  if (manifest.kind === `child`) return manifest.entity_url
  if (manifest.kind === `source` && manifest.sourceType === `entity`) {
    return manifest.sourceRef
  }
  return null
}

function getManifestStateSourceId(manifest: Manifest): string | null {
  if (manifest.kind === `shared-state`) return manifest.id
  if (manifest.kind === `source` && manifest.sourceType === `db`) {
    return manifest.sourceRef
  }
  return null
}

function describeSourceConfig(config: Record<string, unknown>): string {
  const cache = typeof config.cache === `string` ? config.cache : null
  const keys = Object.keys(config).filter((key) => key !== `cache`)
  return [cache, keys.length > 0 ? `${keys.length} config keys` : null]
    .filter(Boolean)
    .join(` · `)
}

function shortJson(value: unknown): string {
  const json = JSON.stringify(value)
  return json.length > 80 ? `${json.slice(0, 77)}...` : json
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(` `)
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
  entityUrl,
  tileId,
}: {
  section: TimelineEntry[`section`]
  responseTimestamp: TimelineEntry[`responseTimestamp`]
  entityStopped: boolean
  isStreaming: boolean
  renderWidth: number
  entityUrl: string | null
  tileId: string | null
}): React.ReactElement {
  if (section.kind === `user_message`) {
    return <UserMessage section={section} />
  }
  if (section.kind === `wake`) {
    return <WakeTimelineRow section={section} />
  }
  if (section.kind === `manifest`) {
    return (
      <ManifestTimelineRow
        manifest={section.manifest}
        entityUrl={entityUrl}
        tileId={tileId}
      />
    )
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
  entityUrl = null,
}: {
  entries: Array<TimelineEntry>
  loading: boolean
  error: string | null
  entityStopped: boolean
  cacheKey?: string | null
  tileId?: string | null
  entityUrl?: string | null
}): React.ReactElement {
  const rows = useMemo(() => entries, [entries])
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(
    null
  )
  const [viewportWidth, setViewportWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const isNearBottom = useRef(true)
  const lastScrollTopRef = useRef(0)
  const spawnMarkerRef = useRef<HTMLSpanElement | null>(null)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const [showTopDivider, setShowTopDivider] = useState(false)
  const cachedSizeMapRef = useRef(new Map<string, number>())
  const lastMeasureAtRef = useRef(new Map<string, number>())
  const settledKeysRef = useRef(new Set<string>())
  const settleCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const firstMessage = rows.find(
    (
      row
    ): row is TimelineEntry & {
      section: Extract<TimelineEntry[`section`], { kind: `user_message` }>
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
    gap: 0,
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

    const detachFromBottom = () => {
      isNearBottom.current = false
      setShowJumpToBottom(true)
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && viewport.scrollTop > 0) {
        detachFromBottom()
      }
    }

    const handleScroll = () => {
      const distanceFromBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      const scrollingUp = viewport.scrollTop < lastScrollTopRef.current - 1
      const pinnedToBottom = distanceFromBottom <= BOTTOM_PIN_THRESHOLD

      if (scrollingUp && !pinnedToBottom) {
        detachFromBottom()
      } else if (pinnedToBottom) {
        isNearBottom.current = true
      }

      lastScrollTopRef.current = viewport.scrollTop
      const spawnMarker = spawnMarkerRef.current
      if (spawnMarker) {
        const markerRect = spawnMarker.getBoundingClientRect()
        const viewportRect = viewport.getBoundingClientRect()
        setShowTopDivider(markerRect.top <= viewportRect.top)
      } else {
        setShowTopDivider(false)
      }
      setShowJumpToBottom(!isNearBottom.current)
    }

    handleScroll()
    viewport.addEventListener(`wheel`, handleWheel, { passive: true })
    viewport.addEventListener(`scroll`, handleScroll, { passive: true })
    return () => {
      viewport.removeEventListener(`wheel`, handleWheel)
      viewport.removeEventListener(`scroll`, handleScroll)
    }
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
      isNearBottom.current = true
      setShowJumpToBottom(false)
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
    <div className={styles.root} data-desktop-selection-context="">
      <div
        className={styles.topDivider}
        data-visible={showTopDivider ? `true` : undefined}
        aria-hidden="true"
      />
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
                <span ref={spawnMarkerRef} className={styles.statusPill}>
                  <Text size={1} tone="muted" className={styles.statusText}>
                    spawned
                  </Text>
                  <Text size={1} tone="muted" className={styles.statusText}>
                    ·
                  </Text>
                  <Text size={1} tone="muted" className={styles.statusText}>
                    {formatChatTimestamp(spawnTime)}
                  </Text>
                </span>
              </Tooltip>
            ) : (
              <span ref={spawnMarkerRef} className={styles.statusPill}>
                <Text size={1} tone="muted" className={styles.statusText}>
                  spawned
                </Text>
              </span>
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
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      paddingBottom: timelineRowGap(row),
                    }}
                  >
                    <TimelineRow
                      section={row.section}
                      responseTimestamp={row.responseTimestamp}
                      entityStopped={entityStopped}
                      isStreaming={row.key === lastStreamingAgentKey}
                      renderWidth={contentWidth}
                      entityUrl={entityUrl}
                      tileId={tileId ?? null}
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

      <button
        type="button"
        className={styles.jumpToBottom}
        data-visible={showJumpToBottom ? `true` : undefined}
        onClick={jumpToBottom}
        aria-label="Jump to latest"
        aria-hidden={!showJumpToBottom}
        tabIndex={showJumpToBottom ? 0 : -1}
      >
        <Icon icon={ArrowDown} size={3} />
      </button>
    </div>
  )
}
