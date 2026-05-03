import {
  Crosshair,
  ListCollapse,
  ListTree,
  Plus,
  SkipForward,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isControlEvent } from '@durable-streams/state'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Badge, Code, IconButton, Stack, Text, Tooltip } from '../../ui'
import type { BadgeTone } from '../../ui'
import styles from './EventSidebar.module.css'
import type { ChangeEvent, StateEvent } from '@durable-streams/state'

function opBadge(op: string): { label: string; tone: BadgeTone } {
  switch (op) {
    case `insert`:
      return { label: `INS`, tone: `success` }
    case `update`:
      return { label: `UPD`, tone: `yellow` }
    case `delete`:
      return { label: `DEL`, tone: `danger` }
    case `upsert`:
      return { label: `UPS`, tone: `info` }
    default:
      return { label: op.toUpperCase().slice(0, 3), tone: `neutral` }
  }
}

function controlBadge(control: string): { label: string; tone: BadgeTone } {
  switch (control) {
    case `snapshot-start`:
      return { label: `SNAP▸`, tone: `neutral` }
    case `snapshot-end`:
      return { label: `◂SNAP`, tone: `neutral` }
    case `reset`:
      return { label: `RESET`, tone: `neutral` }
    default:
      return { label: control.toUpperCase().slice(0, 5), tone: `neutral` }
  }
}

const COLLAPSED_ROW_HEIGHT = 28
const EXPANDED_ROW_ESTIMATE = 200
const ICON_SIZE = 14

export function EventSidebar({
  events,
  cursorIndex,
  onSelectEvent,
  onNavigateToEvent,
  onGoLive,
  style,
}: {
  events: Array<StateEvent>
  cursorIndex: number | null
  onSelectEvent: (index: number) => void
  onNavigateToEvent: (index: number) => void
  onGoLive: () => void
  style?: React.CSSProperties
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set())

  const handleToggleEvent = useCallback((index: number) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }, [])

  const handleExpandAll = useCallback(() => {
    setExpandedEvents(new Set(events.map((_, i) => i)))
  }, [events])

  const handleCollapseAll = useCallback(() => {
    setExpandedEvents(new Set())
  }, [])

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) =>
      expandedEvents.has(index) ? EXPANDED_ROW_ESTIMATE : COLLAPSED_ROW_HEIGHT,
    overscan: 15,
  })

  useEffect(() => {
    if (cursorIndex !== null) {
      virtualizer.scrollToIndex(cursorIndex, { align: `center` })
    }
  }, [cursorIndex, virtualizer])

  const padWidth = String(events.length).length

  return (
    <Stack direction="column" className={styles.sidebar} style={style}>
      <Stack align="center" gap={2} px={3} py={1} className={styles.header}>
        <Text
          size={1}
          tone="muted"
          weight="medium"
          className={styles.headerLabel}
        >
          Events
        </Text>
        <Badge size={1} variant="soft" tone="neutral">
          {events.length}
        </Badge>
        <Stack align="center" gap={1} className={styles.headerActions}>
          <IconButton
            size={1}
            variant="ghost"
            tone="neutral"
            title={cursorIndex === null ? `Already live` : `Go to live`}
            onClick={onGoLive}
            disabled={cursorIndex === null}
            aria-label="Go to live"
          >
            <SkipForward size={ICON_SIZE} />
          </IconButton>
          <IconButton
            size={1}
            variant="ghost"
            tone="neutral"
            title="Expand all events"
            onClick={handleExpandAll}
            aria-label="Expand all events"
          >
            <ListTree size={ICON_SIZE} />
          </IconButton>
          <IconButton
            size={1}
            variant="ghost"
            tone="neutral"
            title="Collapse all events"
            onClick={handleCollapseAll}
            aria-label="Collapse all events"
          >
            <ListCollapse size={ICON_SIZE} />
          </IconButton>
        </Stack>
      </Stack>

      <div ref={scrollContainerRef} className={styles.eventListScroll}>
        <div
          className={styles.virtualWindow}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const index = virtualItem.index
            const event = events[index]
            const isSelected =
              cursorIndex !== null ? index === cursorIndex : false
            const isDimmed = cursorIndex !== null && index > cursorIndex
            const isOpen = expandedEvents.has(index)

            return (
              <div
                key={index}
                ref={virtualizer.measureElement}
                data-index={index}
                data-selected={isSelected}
                data-dimmed={isDimmed}
                className={styles.eventRow}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
                onClick={() => onSelectEvent(index)}
              >
                {isControlEvent(event) ? (
                  <ControlEventContent
                    event={event}
                    isOpen={isOpen}
                    index={index}
                    padWidth={padWidth}
                    onToggle={(e) => {
                      e.stopPropagation()
                      handleToggleEvent(index)
                    }}
                  />
                ) : (
                  <ChangeEventContent
                    event={event as ChangeEvent}
                    isOpen={isOpen}
                    index={index}
                    padWidth={padWidth}
                    onToggle={(e) => {
                      e.stopPropagation()
                      handleToggleEvent(index)
                    }}
                    onNavigate={(e) => {
                      e.stopPropagation()
                      onNavigateToEvent(index)
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Stack>
  )
}

function EventIndex({ index, padWidth }: { index: number; padWidth: number }) {
  const padded = String(index + 1).padStart(padWidth, `0`)
  return (
    <Text size={1} tone="muted" family="mono" className={styles.shrink0}>
      {padded}
    </Text>
  )
}

function ControlEventContent({
  event,
  isOpen,
  index,
  padWidth,
  onToggle,
}: {
  event: { headers: { control: string } }
  isOpen: boolean
  index: number
  padWidth: number
  onToggle: (e: React.MouseEvent) => void
}) {
  const { label, tone } = controlBadge(event.headers.control)
  return (
    <>
      <Stack align="center" gap={2} className={styles.eventRowHeader}>
        <EventIndex index={index} padWidth={padWidth} />
        <Badge size={1} variant="soft" tone={tone} className={styles.monoBadge}>
          {label}
        </Badge>
        <Code size={1} variant="ghost" className={styles.eventKey}>
          control
        </Code>
        <IconButton
          size={1}
          variant="ghost"
          tone="neutral"
          title={isOpen ? `Collapse event` : `Expand event`}
          onClick={onToggle}
          className={styles.expandButton}
          data-open={isOpen}
          aria-label={isOpen ? `Collapse event` : `Expand event`}
        >
          <Plus size={ICON_SIZE} />
        </IconButton>
      </Stack>
      {isOpen && (
        <Code size={1} variant="ghost" className={styles.eventValue}>
          {JSON.stringify(event, null, 2)}
        </Code>
      )}
    </>
  )
}

function ChangeEventContent({
  event,
  isOpen,
  index,
  padWidth,
  onToggle,
  onNavigate,
}: {
  event: ChangeEvent
  isOpen: boolean
  index: number
  padWidth: number
  onToggle: (e: React.MouseEvent) => void
  onNavigate: (e: React.MouseEvent) => void
}) {
  const { label, tone } = opBadge(event.headers.operation)
  return (
    <>
      <Stack align="center" gap={2} className={styles.eventRowHeader}>
        <EventIndex index={index} padWidth={padWidth} />
        <Badge size={1} variant="soft" tone={tone} className={styles.monoBadge}>
          {label}
        </Badge>
        <Code size={1} variant="ghost" truncate className={styles.eventKey}>
          {event.type}:{event.key}
        </Code>
        <IconButton
          size={1}
          variant="ghost"
          tone="neutral"
          title={isOpen ? `Collapse event` : `Expand event`}
          onClick={onToggle}
          className={styles.expandButton}
          data-open={isOpen}
          aria-label={isOpen ? `Collapse event` : `Expand event`}
        >
          <Plus size={ICON_SIZE} />
        </IconButton>
        <Tooltip content={`Focus ${event.type}:${event.key}`}>
          <IconButton
            size={1}
            variant="ghost"
            tone="neutral"
            onClick={onNavigate}
            className={styles.shrink0}
            aria-label={`Focus ${event.type}:${event.key}`}
          >
            <Crosshair size={ICON_SIZE} />
          </IconButton>
        </Tooltip>
      </Stack>
      {isOpen && (
        <Code size={1} variant="ghost" className={styles.eventValue}>
          {JSON.stringify(event, null, 2)}
        </Code>
      )}
    </>
  )
}
