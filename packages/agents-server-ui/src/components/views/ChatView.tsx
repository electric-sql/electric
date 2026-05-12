import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useEntityTimeline } from '../../hooks/useEntityTimeline'
import { EntityTimeline } from '../EntityTimeline'
import { MessageInput } from '../MessageInput'
import { EntityContextDrawer } from '../EntityContextDrawer'
import { readTextPayload } from '../../lib/sendMessage'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import type { ViewProps } from '../../lib/workspace/viewRegistry'
import type { TimelineEntry } from '../../lib/timelineEntries'
import type { OptimisticInboxMessage } from '../../lib/sendMessage'

const INLINE_QUEUED_TIMEOUT_MS = 15_000

/**
 * The default view: chat / timeline + message composer.
 *
 * Drives a generic timeline via `useEntityTimeline` for every entity
 * type — keeping this view sub-type-agnostic means the rest of the
 * workspace (registry, menu, tab strip) doesn't need to care about
 * entity sub-types either.
 */
export function ChatView({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  isSpawning,
  tileId,
}: ViewProps): React.ReactElement {
  // While `spawning`, the entity has no inbox yet — `connectUrl` is null
  // so `useEntityTimeline` doesn't try to subscribe and we render an empty
  // timeline / disabled composer.
  const connectUrl = isSpawning ? null : entityUrl

  return (
    <GenericChatBody
      baseUrl={baseUrl}
      entityUrl={connectUrl}
      entity={entity}
      entityStopped={entityStopped}
      isSpawning={isSpawning}
      tileId={tileId}
    />
  )
}

function GenericChatBody({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  isSpawning,
  tileId,
}: {
  baseUrl: string
  entityUrl: string | null
  entity: ViewProps[`entity`]
  entityStopped: boolean
  isSpawning: boolean
  tileId: string
}): React.ReactElement {
  const {
    entries,
    pendingInbox,
    entities,
    generationActive,
    db,
    loading,
    error,
  } = useEntityTimeline(baseUrl || null, entityUrl)
  const { signalEntity } = useElectricAgents()
  const navigate = useNavigate()
  const [sentMessageSignal, setSentMessageSignal] = useState(0)
  const [stopPending, setStopPending] = useState(false)
  const [inlineQueuedMessages, setInlineQueuedMessages] = useState<
    Map<string, OptimisticInboxMessage>
  >(() => new Map())
  const inlineTimeoutsRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  )
  const processedInboxKeys = useMemo(
    () =>
      new Set(
        entries
          .filter((entry) => entry.section.kind === `user_message`)
          .map((entry) => entry.key.replace(/^inbox:/, ``))
      ),
    [entries]
  )
  const pendingInboxByKey = useMemo(
    () => new Map(pendingInbox.map((message) => [message.key, message])),
    [pendingInbox]
  )
  const projectedPendingMessage = useMemo(() => {
    for (const [key, message] of inlineQueuedMessages) {
      if (processedInboxKeys.has(key)) continue
      return pendingInboxByKey.get(key) ?? message
    }
    return null
  }, [inlineQueuedMessages, pendingInboxByKey, processedInboxKeys])
  const visiblePendingInbox = useMemo(
    () =>
      projectedPendingMessage
        ? pendingInbox.filter(
            (message) => message.key !== projectedPendingMessage.key
          )
        : pendingInbox,
    [pendingInbox, projectedPendingMessage]
  )
  const visibleEntries = useMemo<Array<TimelineEntry>>(() => {
    if (!projectedPendingMessage) return entries
    const timestamp = Date.parse(projectedPendingMessage.timestamp)
    const hasUserMessage = entries.some(
      (entry) => entry.section.kind === `user_message`
    )
    return [
      ...entries,
      {
        key: `pending-inbox:${projectedPendingMessage.key}`,
        order: Number.MAX_SAFE_INTEGER,
        responseTimestamp: null,
        section: {
          kind: `user_message`,
          from: projectedPendingMessage.from ?? `user`,
          text: readTextPayload(projectedPendingMessage.payload),
          timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
          isInitial: !hasUserMessage,
        },
      },
    ]
  }, [entries, projectedPendingMessage])

  const rememberInlineQueuedMessage = useCallback(
    (message: OptimisticInboxMessage) => {
      setInlineQueuedMessages((current) => {
        const next = new Map(current)
        next.set(message.key, message)
        return next
      })
      const existingTimeout = inlineTimeoutsRef.current.get(message.key)
      if (existingTimeout) clearTimeout(existingTimeout)
      const timeout = setTimeout(() => {
        inlineTimeoutsRef.current.delete(message.key)
        setInlineQueuedMessages((current) => {
          if (!current.has(message.key)) return current
          const next = new Map(current)
          next.delete(message.key)
          return next
        })
      }, INLINE_QUEUED_TIMEOUT_MS)
      inlineTimeoutsRef.current.set(message.key, timeout)
    },
    []
  )

  useEffect(() => {
    setInlineQueuedMessages((current) => {
      let next: Map<string, OptimisticInboxMessage> | null = null
      for (const key of current.keys()) {
        if (!processedInboxKeys.has(key)) continue
        next ??= new Map(current)
        next.delete(key)
        const timeout = inlineTimeoutsRef.current.get(key)
        if (timeout) clearTimeout(timeout)
        inlineTimeoutsRef.current.delete(key)
      }
      return next ?? current
    })
  }, [processedInboxKeys])

  useEffect(
    () => () => {
      for (const timeout of inlineTimeoutsRef.current.values()) {
        clearTimeout(timeout)
      }
      inlineTimeoutsRef.current.clear()
    },
    []
  )

  // If the timeline subscription errors out for an entity that isn't
  // currently spawning (so the failure isn't transient), bounce back to
  // the new-session screen — same behaviour as the previous in-route
  // implementation.
  useEffect(() => {
    if (error && !isSpawning) {
      void navigate({ to: `/` })
    }
  }, [error, navigate, isSpawning])

  useEffect(() => {
    if (!generationActive) {
      setStopPending(false)
    }
  }, [generationActive])

  useEffect(() => {
    setStopPending(false)
  }, [entityUrl])

  const stopGeneration = useCallback(() => {
    if (!entityUrl || !signalEntity || !generationActive || stopPending) return
    setStopPending(true)
    const tx = signalEntity({
      entityUrl,
      signal: `SIGINT`,
      reason: `Stopped from chat UI`,
    })
    tx.isPersisted.promise.catch(() => {
      setStopPending(false)
    })
  }, [entityUrl, generationActive, signalEntity, stopPending])

  return (
    <>
      <EntityTimeline
        entries={visibleEntries}
        loading={loading}
        error={error}
        entityStopped={entityStopped}
        cacheKey={`${baseUrl}${entityUrl ?? ``}`}
        tileId={tileId}
        entityUrl={entityUrl}
        entities={entities}
        scrollToBottomSignal={sentMessageSignal}
        onStopGeneration={stopGeneration}
        stopPending={stopPending}
      />
      <MessageInput
        db={db}
        baseUrl={baseUrl}
        entityUrl={entityUrl ?? ``}
        disabled={entityStopped || !db}
        generationActive={generationActive}
        stopPending={stopPending}
        pendingMessages={visiblePendingInbox}
        inlineQueuedSubmits={
          !entityStopped &&
          !generationActive &&
          pendingInbox.length === 0 &&
          inlineQueuedMessages.size === 0
        }
        onOptimisticQueuedMessage={rememberInlineQueuedMessage}
        drawer={(pending) => (
          <EntityContextDrawer
            entity={entity}
            db={db}
            tileId={tileId}
            pendingMessages={pending.pendingMessages}
            pendingEditingKey={pending.editingKey}
            onEditPending={pending.onEdit}
            onDeletePending={pending.onDelete}
            onSteerPending={pending.onSteer}
            onReorderPending={pending.onReorder}
          />
        )}
        onSend={() => setSentMessageSignal((value) => value + 1)}
        onStop={stopGeneration}
      />
    </>
  )
}
