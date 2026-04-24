import { Flex, Text } from '@radix-ui/themes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MaterializedState,
  isChangeEvent,
  isControlEvent,
} from '@durable-streams/state'
import { stream as createStream } from '@durable-streams/client'
import { TypeList } from './TypeList'
import { StateTable } from './StateTable'
import { EventSidebar } from './EventSidebar'
import type { ChangeEvent, StateEvent } from '@durable-streams/state'

/** Runtime guard — checks that the value has a `headers` object before
 *  delegating to the library's `isChangeEvent`/`isControlEvent` guards. */
function isStateEvent(value: unknown): value is StateEvent {
  return (
    typeof value === `object` &&
    value !== null &&
    `headers` in value &&
    typeof (value as Record<string, unknown>).headers === `object`
  )
}

export function StateExplorerPanel({
  baseUrl,
  entityUrl,
}: {
  baseUrl: string
  entityUrl: string
}) {
  const [events, setEvents] = useState<Array<StateEvent>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const liveTail = true
  const [cursorIndex, setCursorIndex] = useState<number | null>(null)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [focusedRow, setFocusedRow] = useState<{
    type: string
    key: string
  } | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [splitRatio, setSplitRatio] = useState(0.6) // top gets 60%

  // Connect to the entity's main stream
  useEffect(() => {
    let cancelled = false

    const loadContent = async () => {
      setIsLoading(true)
      setError(null)
      setEvents([])
      setCursorIndex(null)

      try {
        const streamUrl = `${baseUrl}${entityUrl}/main`

        const res = await createStream({
          url: streamUrl,
          offset: `-1`,
          live: liveTail,
        })

        cancelRef.current = () => res.cancel()

        res.subscribeJson(async (batch: { items: ReadonlyArray<unknown> }) => {
          if (cancelled) return
          const rawItems = batch.items.flatMap((item: unknown) =>
            Array.isArray(item) ? (item as Array<unknown>) : [item]
          )
          const newEvents = rawItems.filter(isStateEvent)
          setEvents((prev) => [...prev, ...newEvents])
          setIsLoading(false)
        })
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : `Failed to load stream content`
          )
          setIsLoading(false)
        }
      }
    }

    loadContent()

    return () => {
      cancelled = true
      if (cancelRef.current) {
        cancelRef.current()
        cancelRef.current = null
      }
    }
  }, [baseUrl, entityUrl])

  // Derive materialized state at cursor
  const materializedState = useMemo(() => {
    const state = new MaterializedState()
    const end = cursorIndex === null ? events.length : cursorIndex + 1
    for (let i = 0; i < end; i++) {
      const event = events[i]
      if (isChangeEvent(event)) {
        state.apply(event)
      } else if (isControlEvent(event) && event.headers.control === `reset`) {
        state.clear()
      }
    }
    return state
  }, [events, cursorIndex])

  // Auto-select first type, or reset if selected type disappears during time-travel
  useEffect(() => {
    const types = materializedState.types
    if (types.length === 0) {
      setSelectedType(null)
    } else if (selectedType === null || !types.includes(selectedType)) {
      setSelectedType(types[0])
    }
  }, [materializedState, selectedType])

  // Track the affected entity from the cursor event (type + key)
  const cursorTarget = useMemo(() => {
    if (cursorIndex === null) return null
    const event = events[cursorIndex]
    if (event && isChangeEvent(event)) {
      const change = event as ChangeEvent
      return { type: change.type, key: change.key }
    }
    return null
  }, [events, cursorIndex])

  // Highlight from cursor event or from FK navigation
  const highlightKey =
    focusedRow && focusedRow.type === selectedType
      ? focusedRow.key
      : cursorTarget && cursorTarget.type === selectedType
        ? cursorTarget.key
        : null

  // Clear focusedRow when user changes type or cursor
  useEffect(() => {
    setFocusedRow(null)
  }, [cursorIndex, selectedType])

  const handleSelectEvent = useCallback((index: number) => {
    setCursorIndex(index)
  }, [])

  const handleNavigateToEvent = useCallback(
    (index: number) => {
      setCursorIndex(index)
      const event = events[index]
      if (event && isChangeEvent(event)) {
        const change = event as ChangeEvent
        setSelectedType(change.type)
      }
    },
    [events]
  )

  const handleNavigateToRow = useCallback((type: string, key: string) => {
    setSelectedType(type)
    setFocusedRow({ type, key })
  }, [])

  const handleGoLive = useCallback(() => {
    setCursorIndex(null)
  }, [])

  if (error) {
    return (
      <Flex align="center" justify="center" py="8">
        <Text size="1" color="red">
          {error}
        </Text>
      </Flex>
    )
  }

  if (isLoading && events.length === 0) {
    return (
      <Flex justify="center" align="center" py="8">
        <Text size="1" color="gray">
          Loading stream…
        </Text>
      </Flex>
    )
  }

  if (events.length === 0) {
    return (
      <Flex align="center" justify="center" py="8">
        <Text size="1" color="gray">
          No state events in this stream yet
        </Text>
      </Flex>
    )
  }

  return (
    <Flex
      ref={containerRef}
      direction="column"
      style={{ flex: 1, minHeight: 0, overflow: `hidden` }}
    >
      {/* TypeList + StateTable */}
      <Flex
        style={{
          flex: `${splitRatio} 1 0%`,
          minHeight: 0,
          overflow: `hidden`,
        }}
      >
        <TypeList
          state={materializedState}
          selectedType={selectedType}
          onSelectType={setSelectedType}
        />
        <StateTable
          state={materializedState}
          selectedType={selectedType}
          onNavigateToRow={handleNavigateToRow}
          highlightKey={highlightKey}
        />
      </Flex>

      {/* Draggable separator */}
      <div
        style={{
          height: 4,
          cursor: `row-resize`,
          flexShrink: 0,
          background: `var(--gray-a5)`,
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          const container = containerRef.current
          if (!container) return
          const startY = e.clientY
          const startRatio = splitRatio
          const rect = container.getBoundingClientRect()
          const onMouseMove = (ev: MouseEvent) => {
            const dy = ev.clientY - startY
            const newRatio = Math.min(
              0.8,
              Math.max(0.15, startRatio + dy / rect.height)
            )
            setSplitRatio(newRatio)
          }
          const onMouseUp = () => {
            document.removeEventListener(`mousemove`, onMouseMove)
            document.removeEventListener(`mouseup`, onMouseUp)
            document.body.style.cursor = ``
            document.body.style.userSelect = ``
          }
          document.body.style.cursor = `row-resize`
          document.body.style.userSelect = `none`
          document.addEventListener(`mousemove`, onMouseMove)
          document.addEventListener(`mouseup`, onMouseUp)
        }}
      />

      {/* Events section */}
      <EventSidebar
        events={events}
        cursorIndex={cursorIndex}
        onSelectEvent={handleSelectEvent}
        onNavigateToEvent={handleNavigateToEvent}
        onGoLive={handleGoLive}
        style={{ flex: `${1 - splitRatio} 1 0%`, minHeight: 0 }}
      />
    </Flex>
  )
}
