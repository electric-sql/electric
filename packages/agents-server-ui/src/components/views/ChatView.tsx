import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useEntityTimeline } from '../../hooks/useEntityTimeline'
import { EntityTimeline } from '../EntityTimeline'
import { MessageInput } from '../MessageInput'
import { EntityContextDrawer } from '../EntityContextDrawer'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import type { ViewProps } from '../../lib/workspace/viewRegistry'
import type { EntityTimelineQueryRow } from '@electric-ax/agents-runtime/client'
import type { OptimisticInboxMessage } from '../../lib/sendMessage'

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

export function ChatLogView({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  isSpawning,
  tileId,
  scrollToBottomSignal,
  inlineQueuedMessages = [],
}: ViewProps & {
  scrollToBottomSignal?: number
  inlineQueuedMessages?: Array<OptimisticInboxMessage>
}): React.ReactElement {
  const connectUrl = isSpawning ? null : entityUrl
  const { timelineRows, pendingInbox, entities, loading, error } =
    useEntityTimeline(baseUrl || null, connectUrl)
  const navigate = useNavigate()
  const processedInboxKeys = useMemo(
    () =>
      new Set(
        timelineRows.filter((row) => row.inbox).map((row) => row.inbox!.key)
      ),
    [timelineRows]
  )
  const pendingInboxByKey = useMemo(
    () => new Map(pendingInbox.map((message) => [message.key, message])),
    [pendingInbox]
  )
  const projectedPendingMessage = useMemo(() => {
    if (entity.status === `running`) return null
    for (const message of inlineQueuedMessages) {
      if (processedInboxKeys.has(message.key)) continue
      return pendingInboxByKey.get(message.key) ?? message
    }
    return null
  }, [
    entity.status,
    inlineQueuedMessages,
    pendingInboxByKey,
    processedInboxKeys,
  ])
  const visibleRows = useMemo<Array<EntityTimelineQueryRow>>(() => {
    if (!projectedPendingMessage) return timelineRows
    return [
      ...timelineRows,
      {
        $key: `pending-inbox:${projectedPendingMessage.key}`,
        inbox: projectedPendingMessage,
      } as EntityTimelineQueryRow,
    ]
  }, [projectedPendingMessage, timelineRows])

  useEffect(() => {
    if (error && !isSpawning) {
      void navigate({ to: `/` })
    }
  }, [error, navigate, isSpawning])

  return (
    <EntityTimeline
      rows={visibleRows}
      loading={loading}
      error={error}
      entityStopped={entityStopped}
      cacheKey={`${baseUrl}${connectUrl ?? ``}:${scrollToBottomSignal ?? 0}`}
      tileId={tileId}
      entityUrl={connectUrl}
      entities={entities}
      scrollToBottomSignal={scrollToBottomSignal}
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
    timelineRows,
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
  const optimisticInlineInboxKeys = useMemo(
    () =>
      new Set(
        timelineRows
          .filter((row) => row.inbox?.status === `pending`)
          .map((row) => row.inbox!.key)
      ),
    [timelineRows]
  )
  const visiblePendingInbox = useMemo(
    () =>
      pendingInbox.filter(
        (message) => !optimisticInlineInboxKeys.has(message.key)
      ),
    [optimisticInlineInboxKeys, pendingInbox]
  )
  const inlinePendingInbox =
    !entityStopped && !generationActive ? visiblePendingInbox[0] : undefined
  const timelineRowsWithInlinePending = useMemo<Array<EntityTimelineQueryRow>>(
    () =>
      inlinePendingInbox
        ? [
            ...timelineRows,
            {
              $key: `pending-inbox:${inlinePendingInbox.key}`,
              inbox: inlinePendingInbox,
            } as EntityTimelineQueryRow,
          ]
        : timelineRows,
    [inlinePendingInbox, timelineRows]
  )
  const drawerPendingInbox = inlinePendingInbox
    ? visiblePendingInbox.slice(1)
    : visiblePendingInbox

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
        rows={timelineRowsWithInlinePending}
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
        pendingMessages={drawerPendingInbox}
        inlineQueuedSubmits={
          !entityStopped &&
          !generationActive &&
          visiblePendingInbox.length === 0
        }
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
