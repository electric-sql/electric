import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MaterializedState,
  isChangeEvent,
  isControlEvent,
} from '@durable-streams/state'
import { stream as createStream } from '@durable-streams/client'
import { Badge, Select, Stack, Text } from '../../ui'
import { Splitter } from '../workspace/Splitter'
import { TypeList } from './TypeList'
import { StateTable } from './StateTable'
import { EventSidebar } from './EventSidebar'
import styles from './StateExplorerPanel.module.css'
import type { ChangeEvent, StateEvent } from '@durable-streams/state'

type StreamLoadState = {
  events: Array<StateEvent>
  isLoading: boolean
  error: string | null
}

type SharedStateSource = {
  key: string
  id: string
  path: string
  collections: Record<string, { type: string; primaryKey: string }>
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null
}

function getSharedStateStreamPath(id: string): string {
  return `/_electric/shared-state/${id}`
}

function getManifestRecord(row: unknown): Record<string, unknown> | null {
  if (!isRecord(row)) return null
  const nested = row.manifest
  if (isRecord(nested)) return nested
  return row
}

function getCollections(
  value: unknown
): Record<string, { type: string; primaryKey: string }> | null {
  if (!isRecord(value)) return null

  const collections: Record<string, { type: string; primaryKey: string }> = {}
  for (const [name, config] of Object.entries(value)) {
    if (!isRecord(config)) continue
    const type = config.type
    const primaryKey = config.primaryKey
    if (typeof type === `string` && typeof primaryKey === `string`) {
      collections[name] = { type, primaryKey }
    }
  }

  return Object.keys(collections).length > 0 ? collections : null
}

function materializeEvents(
  events: Array<StateEvent>,
  cursorIndex: number | null
): MaterializedState {
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
}

function deriveSharedStateSources(
  state: MaterializedState
): Array<SharedStateSource> {
  if (!state.types.includes(`manifest`)) return []

  const sources = new Map<string, SharedStateSource>()
  for (const row of state.getType(`manifest`).values()) {
    const manifest = getManifestRecord(row)
    if (!manifest) continue

    if (manifest.kind === `shared-state` && typeof manifest.id === `string`) {
      const collections = getCollections(manifest.collections)
      if (!collections) continue
      sources.set(manifest.id, {
        key: `shared:${manifest.id}`,
        id: manifest.id,
        path: getSharedStateStreamPath(manifest.id),
        collections,
      })
      continue
    }

    if (
      manifest.kind === `source` &&
      manifest.sourceType === `db` &&
      typeof manifest.sourceRef === `string`
    ) {
      const config = isRecord(manifest.config) ? manifest.config : null
      const collections = getCollections(config?.collections)
      if (!collections || sources.has(manifest.sourceRef)) continue
      sources.set(manifest.sourceRef, {
        key: `shared:${manifest.sourceRef}`,
        id: manifest.sourceRef,
        path: getSharedStateStreamPath(manifest.sourceRef),
        collections,
      })
    }
  }

  return Array.from(sources.values()).sort((a, b) => a.id.localeCompare(b.id))
}

function useStateStream(
  baseUrl: string,
  streamPath: string | null,
  live: boolean
): StreamLoadState {
  const [events, setEvents] = useState<Array<StateEvent>>([])
  const [isLoading, setIsLoading] = useState(Boolean(streamPath))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let cancel: (() => void) | null = null

    setEvents([])
    setError(null)

    if (!streamPath) {
      setIsLoading(false)
      return
    }

    const loadContent = async () => {
      setIsLoading(true)

      try {
        const res = await createStream({
          url: `${baseUrl}${streamPath}`,
          offset: `-1`,
          live,
        })

        cancel = () => res.cancel()

        res.subscribeJson((batch: { items: ReadonlyArray<unknown> }) => {
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

    void loadContent()

    return () => {
      cancelled = true
      cancel?.()
    }
  }, [baseUrl, streamPath, live])

  return { events, isLoading, error }
}

export function StateExplorerPanel({
  baseUrl,
  entityUrl,
}: {
  baseUrl: string
  entityUrl: string
}) {
  const liveTail = true
  const [cursorIndex, setCursorIndex] = useState<number | null>(null)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [selectedSourceKey, setSelectedSourceKey] = useState(`runtime`)
  const [focusedRow, setFocusedRow] = useState<{
    type: string
    key: string
  } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [splitRatio, setSplitRatio] = useState(0.6)

  const runtimeStreamPath = `${entityUrl}/main`
  const runtimeStream = useStateStream(baseUrl, runtimeStreamPath, liveTail)
  const runtimeState = useMemo(
    () => materializeEvents(runtimeStream.events, null),
    [runtimeStream.events]
  )
  const sharedSources = useMemo(
    () => deriveSharedStateSources(runtimeState),
    [runtimeState]
  )

  const selectedSharedSource =
    sharedSources.find((source) => source.key === selectedSourceKey) ?? null
  const sharedStream = useStateStream(
    baseUrl,
    selectedSharedSource?.path ?? null,
    liveTail
  )
  const selectedStream = selectedSharedSource ? sharedStream : runtimeStream
  const events = selectedStream.events
  const isLoading = selectedStream.isLoading
  const error =
    selectedStream.error ??
    (selectedSourceKey === `runtime` ? runtimeStream.error : null)
  const sourceOptionsCount = 1 + sharedSources.length

  useEffect(() => {
    if (
      selectedSourceKey !== `runtime` &&
      !sharedSources.some((source) => source.key === selectedSourceKey)
    ) {
      setSelectedSourceKey(`runtime`)
    }
  }, [selectedSourceKey, sharedSources])

  useEffect(() => {
    setCursorIndex(null)
    setSelectedType(null)
    setFocusedRow(null)
  }, [selectedSourceKey])

  const materializedState = useMemo(() => {
    return materializeEvents(events, cursorIndex)
  }, [events, cursorIndex])

  useEffect(() => {
    const types = materializedState.types
    if (types.length === 0) {
      setSelectedType(null)
    } else if (selectedType === null || !types.includes(selectedType)) {
      setSelectedType(types[0])
    }
  }, [materializedState, selectedType])

  const cursorTarget = useMemo(() => {
    if (cursorIndex === null) return null
    const event = events[cursorIndex]
    if (event && isChangeEvent(event)) {
      const change = event as ChangeEvent
      return { type: change.type, key: change.key }
    }
    return null
  }, [events, cursorIndex])

  const highlightKey =
    focusedRow && focusedRow.type === selectedType
      ? focusedRow.key
      : cursorTarget && cursorTarget.type === selectedType
        ? cursorTarget.key
        : null

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
      <Stack direction="column" className={styles.root}>
        <StateSourceHeader
          selectedSourceKey={selectedSourceKey}
          sourceOptionsCount={sourceOptionsCount}
          sharedSources={sharedSources}
          onSelectSource={setSelectedSourceKey}
        />
        <Stack align="center" justify="center" className={styles.empty}>
          <Text size={1} tone="danger">
            {error}
          </Text>
        </Stack>
      </Stack>
    )
  }

  if (runtimeStream.error && selectedSourceKey !== `runtime`) {
    return (
      <Stack direction="column" className={styles.root}>
        <StateSourceHeader
          selectedSourceKey={selectedSourceKey}
          sourceOptionsCount={sourceOptionsCount}
          sharedSources={sharedSources}
          onSelectSource={setSelectedSourceKey}
        />
        <Stack align="center" justify="center" className={styles.empty}>
          <Text size={1} tone="danger">
            {runtimeStream.error}
          </Text>
        </Stack>
      </Stack>
    )
  }

  if (isLoading && events.length === 0) {
    return (
      <Stack direction="column" className={styles.root}>
        <StateSourceHeader
          selectedSourceKey={selectedSourceKey}
          sourceOptionsCount={sourceOptionsCount}
          sharedSources={sharedSources}
          onSelectSource={setSelectedSourceKey}
        />
        <Stack justify="center" align="center" className={styles.empty}>
          <Text size={1} tone="muted">
            Loading stream…
          </Text>
        </Stack>
      </Stack>
    )
  }

  if (events.length === 0) {
    return (
      <Stack direction="column" className={styles.root}>
        <StateSourceHeader
          selectedSourceKey={selectedSourceKey}
          sourceOptionsCount={sourceOptionsCount}
          sharedSources={sharedSources}
          onSelectSource={setSelectedSourceKey}
        />
        <Stack align="center" justify="center" className={styles.empty}>
          <Text size={1} tone="muted">
            No state events in this stream yet
          </Text>
        </Stack>
      </Stack>
    )
  }

  return (
    <Stack ref={containerRef} direction="column" className={styles.root}>
      <StateSourceHeader
        selectedSourceKey={selectedSourceKey}
        sourceOptionsCount={sourceOptionsCount}
        sharedSources={sharedSources}
        onSelectSource={setSelectedSourceKey}
      />

      <Stack className={styles.row} style={{ flex: `${splitRatio} 1 0%` }}>
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
      </Stack>

      <Splitter
        // Vertical = stacked-layout splitter (horizontal line, row-resize
        // cursor). Drag deltas are cumulative from drag-start; the
        // closure captures `splitRatio` from the render before the drag
        // began, so `splitRatio + delta` always means start+cumulative.
        direction="vertical"
        measureContainer={() =>
          containerRef.current?.getBoundingClientRect().height ?? 0
        }
        onResize={(delta) => {
          setSplitRatio(Math.min(0.8, Math.max(0.15, splitRatio + delta)))
        }}
      />

      <EventSidebar
        events={events}
        cursorIndex={cursorIndex}
        onSelectEvent={handleSelectEvent}
        onNavigateToEvent={handleNavigateToEvent}
        onGoLive={handleGoLive}
        style={{ flex: `${1 - splitRatio} 1 0%`, minHeight: 0 }}
      />
    </Stack>
  )
}

function StateSourceHeader({
  selectedSourceKey,
  sourceOptionsCount,
  sharedSources,
  onSelectSource,
}: {
  selectedSourceKey: string
  sourceOptionsCount: number
  sharedSources: Array<SharedStateSource>
  onSelectSource: (key: string) => void
}) {
  const selectedSource = sharedSources.find(
    (source) => source.key === selectedSourceKey
  )
  return (
    <Stack align="center" gap={2} px={3} py={2} className={styles.header}>
      <Text
        size={1}
        tone="muted"
        weight="medium"
        className={styles.headerLabel}
      >
        StreamDB
      </Text>
      <Badge size={1} variant="soft" tone="neutral">
        {sourceOptionsCount}
      </Badge>
      <Select.Root
        value={selectedSourceKey}
        onValueChange={(v) => {
          if (v !== null) onSelectSource(v)
        }}
      >
        <Select.Trigger className={styles.trigger} />
        <Select.Content>
          <Select.Item value="runtime">Runtime state</Select.Item>
          {sharedSources.map((source) => (
            <Select.Item key={source.key} value={source.key}>
              {`Shared: ${source.id}`}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
      {selectedSourceKey !== `runtime` && selectedSource && (
        <Text size={1} tone="muted" truncate>
          {Object.keys(selectedSource.collections).join(`, `)}
        </Text>
      )}
    </Stack>
  )
}
