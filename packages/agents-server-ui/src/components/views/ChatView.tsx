import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useEntityTimeline } from '../../hooks/useEntityTimeline'
import { EntityTimeline } from '../EntityTimeline'
import { MessageInput } from '../MessageInput'
import { EntityContextDrawer } from '../EntityContextDrawer'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { schemaModelSupportsImageInput } from '../../lib/modelCapabilities'
import {
  useEntityPermission,
  useEntityPermissions,
  type EntityPermission,
} from '../../hooks/useEntityPermission'
import type { ViewProps } from '../../lib/workspace/viewRegistry'
import type { EntityTimelineQueryRow } from '@electric-ax/agents-runtime/client'
import type { EventPointer } from '@electric-ax/agents-runtime'
import type { OptimisticInboxMessage } from '../../lib/sendMessage'
import type { SlashCommandRow } from '@electric-ax/agents-runtime/client'
import type { ForkFromHereAction } from '../UserMessage'

const CHAT_VIEW_PERMISSIONS: ReadonlyArray<EntityPermission> = [
  `write`,
  `signal`,
  `fork`,
]

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
  const { timelineRows, pendingInbox, entities, db, loading, error } =
    useEntityTimeline(baseUrl || null, connectUrl)
  const { forkEntity } = useElectricAgents()
  const canFork = useEntityPermission(entity, `fork`)
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

  const forkFromHereByRunKey = useMemo(() => {
    if (!forkEntity || !connectUrl || !db) return undefined
    const runOffsets = db.collections.runs.__electricRowOffsets
    if (!runOffsets) return undefined
    const map = new Map<string, ForkFromHereAction>()
    let anchor: { rowKey: string; pointer: EventPointer } | null = null
    for (const row of visibleRows) {
      if (row.run && row.run.status === `completed`) {
        const pointer = runOffsets.get(row.run.key)
        anchor = pointer ? { rowKey: row.$key, pointer } : null
      }
      if (row.inbox && anchor) {
        const capturedAnchor = anchor.pointer
        const capturedRunKey = anchor.rowKey
        map.set(
          capturedRunKey,
          canFork
            ? {
                onFork: () => {
                  void forkEntity(connectUrl, { pointer: capturedAnchor })
                    .then((res) =>
                      navigate({
                        to: `/entity/$`,
                        params: { _splat: res.url.replace(/^\//, ``) },
                      })
                    )
                    .catch(() => {})
                },
              }
            : { disabled: true }
        )
      }
    }
    return map
  }, [visibleRows, canFork, db, forkEntity, connectUrl, navigate])

  return (
    <EntityTimeline
      rows={visibleRows}
      loading={loading}
      error={error}
      entityStopped={entityStopped}
      baseUrl={baseUrl}
      cacheKey={`${baseUrl}${connectUrl ?? ``}:${scrollToBottomSignal ?? 0}`}
      tileId={tileId}
      entityUrl={connectUrl}
      entities={entities}
      scrollToBottomSignal={scrollToBottomSignal}
      forkFromHereByRunKey={forkFromHereByRunKey}
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
  const { signalEntity, forkEntity, entityTypesCollection } =
    useElectricAgents()
  const permissions = useEntityPermissions(entity, CHAT_VIEW_PERMISSIONS)
  const canWrite = permissions.write
  const canSignal = permissions.signal
  const canFork = permissions.fork
  const navigate = useNavigate()
  const [sentMessageSignal, setSentMessageSignal] = useState(0)
  const [stopPending, setStopPending] = useState(false)
  const { data: matchingEntityTypes = [] } = useLiveQuery(
    (query) => {
      if (!entityTypesCollection) return undefined
      return query
        .from({ t: entityTypesCollection })
        .where(({ t }) => eq(t.name, entity.type))
    },
    [entityTypesCollection, entity.type]
  )
  const imageAttachmentsEnabled = schemaModelSupportsImageInput(
    matchingEntityTypes[0]?.creation_schema,
    entity.spawn_args
  )
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
  const fallbackSlashCommands = useMemo<Array<SlashCommandRow>>(
    () =>
      (matchingEntityTypes[0]?.slash_commands ?? []).map((command) => ({
        ...command,
        key: `static:${command.name}`,
        source: `static`,
        updated_at: matchingEntityTypes[0]?.updated_at ?? entity.updated_at,
      })),
    [entity.updated_at, matchingEntityTypes]
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
    if (!canSignal) return
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
  }, [canSignal, entityUrl, generationActive, signalEntity, stopPending])

  // "Fork from here" anchor map. For each completed `runs` row that is
  // followed by a user-message inbox row, the run pointer identifies
  // "fork up to and including this response, drop everything after."
  // Completed runs without a following prompt (usually the current end
  // of the conversation) get no entry, preserving the old "historic
  // prompt" affordance while moving it to the response footer.
  const forkFromHereByRunKey = useMemo(() => {
    if (!forkEntity || !entityUrl || !db) return undefined
    const runOffsets = db.collections.runs.__electricRowOffsets
    if (!runOffsets) return undefined
    const map = new Map<string, ForkFromHereAction>()
    let anchor: { rowKey: string; pointer: EventPointer } | null = null
    for (const row of timelineRowsWithInlinePending) {
      if (row.run && row.run.status === `completed`) {
        const pointer = runOffsets.get(row.run.key)
        anchor = pointer ? { rowKey: row.$key, pointer } : null
      }
      if (row.inbox && anchor) {
        const capturedAnchor = anchor.pointer
        const capturedRunKey = anchor.rowKey
        map.set(
          capturedRunKey,
          canFork
            ? {
                onFork: () => {
                  // forkEntity surfaces failures via a danger toast before
                  // rejecting, so the caller just needs to swallow the rejection.
                  void forkEntity(entityUrl, { pointer: capturedAnchor })
                    .then((res) =>
                      navigate({
                        to: `/entity/$`,
                        params: { _splat: res.url.replace(/^\//, ``) },
                      })
                    )
                    .catch(() => {})
                },
              }
            : { disabled: true }
        )
      }
    }
    return map
  }, [
    timelineRowsWithInlinePending,
    canFork,
    db,
    forkEntity,
    entityUrl,
    navigate,
  ])

  return (
    <>
      <EntityTimeline
        rows={timelineRowsWithInlinePending}
        loading={loading}
        error={error}
        entityStopped={entityStopped}
        baseUrl={baseUrl}
        cacheKey={`${baseUrl}${entityUrl ?? ``}`}
        tileId={tileId}
        entityUrl={entityUrl}
        entities={entities}
        scrollToBottomSignal={sentMessageSignal}
        onStopGeneration={stopGeneration}
        stopPending={stopPending}
        forkFromHereByRunKey={forkFromHereByRunKey}
      />
      <MessageInput
        db={db}
        baseUrl={baseUrl}
        entityUrl={entityUrl ?? ``}
        disabled={entityStopped || !db}
        fallbackSlashCommands={fallbackSlashCommands}
        writeDisabled={!canWrite}
        stopDisabled={!canSignal}
        disabledPlaceholder={!canWrite ? `Read-only` : undefined}
        generationActive={generationActive}
        stopPending={stopPending}
        imageAttachmentsEnabled={imageAttachmentsEnabled}
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
            baseUrl={baseUrl}
            tileId={tileId}
            pendingMessages={pending.pendingMessages}
            pendingEditingKey={pending.editingKey}
            pendingActionsDisabled={pending.disabled}
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
