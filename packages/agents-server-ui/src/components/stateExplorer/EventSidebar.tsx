import { Badge, Code, Flex, IconButton, Text, Tooltip } from '@radix-ui/themes'
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
import styles from './EventSidebar.module.css'
import type { ChangeEvent, StateEvent } from '@durable-streams/state'

type BadgeColor = `green` | `yellow` | `red` | `blue` | `gray`

function opBadge(op: string): { label: string; color: BadgeColor } {
  switch (op) {
    case `insert`:
      return { label: `INS`, color: `green` }
    case `update`:
      return { label: `UPD`, color: `yellow` }
    case `delete`:
      return { label: `DEL`, color: `red` }
    case `upsert`:
      return { label: `UPS`, color: `blue` }
    default:
      return { label: op.toUpperCase().slice(0, 3), color: `gray` }
  }
}

function controlBadge(control: string): { label: string; color: BadgeColor } {
  switch (control) {
    case `snapshot-start`:
      return { label: `SNAP▸`, color: `gray` }
    case `snapshot-end`:
      return { label: `◂SNAP`, color: `gray` }
    case `reset`:
      return { label: `RESET`, color: `gray` }
    default:
      return { label: control.toUpperCase().slice(0, 5), color: `gray` }
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

  // Scroll to selected event
  useEffect(() => {
    if (cursorIndex !== null) {
      virtualizer.scrollToIndex(cursorIndex, { align: `center` })
    }
  }, [cursorIndex, virtualizer])

  const padWidth = String(events.length).length

  return (
    <Flex direction="column" className={styles.sidebar} style={style}>
      {/* Header */}
      <Flex align="center" gap="2" px="3" py="1" className={styles.header}>
        <Text
          size="1"
          color="gray"
          weight="medium"
          className={styles.headerLabel}
        >
          Events
        </Text>
        <Badge size="1" variant="soft" color="gray">
          {events.length}
        </Badge>
        <Flex align="center" gap="1" ml="auto">
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            title={cursorIndex === null ? `Already live` : `Go to live`}
            onClick={onGoLive}
            disabled={cursorIndex === null}
          >
            <SkipForward size={ICON_SIZE} />
          </IconButton>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            title="Expand all events"
            onClick={handleExpandAll}
          >
            <ListTree size={ICON_SIZE} />
          </IconButton>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            title="Collapse all events"
            onClick={handleCollapseAll}
          >
            <ListCollapse size={ICON_SIZE} />
          </IconButton>
        </Flex>
      </Flex>

      {/* Virtualized event list */}
      <div ref={scrollContainerRef} className={styles.eventListScroll}>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: `relative`,
          }}
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
                style={{
                  position: `absolute`,
                  top: 0,
                  left: 0,
                  width: `100%`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
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
    </Flex>
  )
}

// ============================================================================
// Control Event Content
// ============================================================================
function EventIndex({ index, padWidth }: { index: number; padWidth: number }) {
  const padded = String(index + 1).padStart(padWidth, `0`)
  return (
    <Text
      size="1"
      color="gray"
      style={{ fontFamily: `var(--code-font-family)`, flexShrink: 0 }}
    >
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
  const { label, color } = controlBadge(event.headers.control)
  return (
    <>
      <Flex align="center" gap="2" className={styles.eventRowHeader}>
        <EventIndex index={index} padWidth={padWidth} />
        <Badge
          size="1"
          variant="soft"
          color={color}
          style={{ fontFamily: `var(--code-font-family)` }}
        >
          {label}
        </Badge>
        <Code size="1" variant="ghost" className={styles.eventKey}>
          control
        </Code>
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          title={isOpen ? `Collapse event` : `Expand event`}
          onClick={onToggle}
          className={styles.expandButton}
          data-open={isOpen}
        >
          <Plus size={ICON_SIZE} />
        </IconButton>
      </Flex>
      {isOpen && (
        <Code size="1" variant="ghost" className={styles.eventValue}>
          {JSON.stringify(event, null, 2)}
        </Code>
      )}
    </>
  )
}

// ============================================================================
// Change Event Content
// ============================================================================
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
  const { label, color } = opBadge(event.headers.operation)
  return (
    <>
      <Flex align="center" gap="2" className={styles.eventRowHeader}>
        <EventIndex index={index} padWidth={padWidth} />
        <Badge
          size="1"
          variant="soft"
          color={color}
          style={{ fontFamily: `var(--code-font-family)` }}
        >
          {label}
        </Badge>
        <Code size="1" variant="ghost" truncate className={styles.eventKey}>
          {event.type}:{event.key}
        </Code>
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          title={isOpen ? `Collapse event` : `Expand event`}
          onClick={onToggle}
          className={styles.expandButton}
          data-open={isOpen}
        >
          <Plus size={ICON_SIZE} />
        </IconButton>
        <Tooltip content={`Focus ${event.type}:${event.key}`}>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={onNavigate}
            style={{ flexShrink: 0 }}
          >
            <Crosshair size={ICON_SIZE} />
          </IconButton>
        </Tooltip>
      </Flex>
      {isOpen && (
        <Code size="1" variant="ghost" className={styles.eventValue}>
          {JSON.stringify(event, null, 2)}
        </Code>
      )}
    </>
  )
}
