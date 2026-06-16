import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useEntityTimeline } from '../../hooks/useEntityTimeline'
import { useForkFromHere } from '../../hooks/useForkFromHere'
import { EntityTimeline } from '../EntityTimeline'
import { GoalBanner } from '../GoalBanner'
import { MessageInput } from '../MessageInput'
import { EntityContextDrawer } from '../EntityContextDrawer'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { useWorkspace } from '../../hooks/useWorkspace'
import { schemaModelSupportsImageInput } from '../../lib/modelCapabilities'
import {
  buildCommentsTimeline,
  COMMENT_FOCUS_PARAM,
  commentFocusViewParams,
  decodeCommentTargetParam,
} from '../../lib/comments'
import type {
  EntityTimelineCommentRow,
  SelectedCommentTarget,
  TimelineRow,
} from '../../lib/comments'
import {
  useEntityPermission,
  useEntityPermissions,
  type EntityPermission,
} from '../../hooks/useEntityPermission'
import type { ViewProps } from '../../lib/workspace/viewRegistry'
import type { CommentTarget } from '@electric-ax/agents-runtime/client'
import type { OptimisticInboxMessage } from '../../lib/sendMessage'
import type { SlashCommandRow } from '@electric-ax/agents-runtime/client'

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
  viewParams,
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
      viewParams={viewParams}
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
  inlineComments = [],
  commentsOnly = false,
  onReplyToComment,
}: ViewProps & {
  scrollToBottomSignal?: number
  inlineQueuedMessages?: Array<OptimisticInboxMessage>
  /**
   * Optimistic comments from the native composer, forwarded across the
   * Expo-DOM boundary because the composer's `db` is a separate JS context
   * from this embed's. Projected into the timeline so a posted comment shows
   * immediately, mirroring desktop where composer and timeline share one `db`.
   * They carry `~pending` orders, so they sort into the same bottom band the
   * shared query would place them in — deduped by key once the row syncs.
   */
  inlineComments?: Array<EntityTimelineCommentRow>
  /** Render only the comment rows (with surrounding context), mirroring CommentsView. */
  commentsOnly?: boolean
  /**
   * Forwarded across the Expo-DOM boundary when the user taps "reply" on a
   * timeline row — the native composer owns the reply target on mobile.
   */
  onReplyToComment?: (target: SelectedCommentTarget) => void
}): React.ReactElement {
  const connectUrl = isSpawning ? null : entityUrl
  const {
    timelineRows,
    pendingInbox,
    entities,
    db,
    loading,
    error,
    commentsEnabled,
  } = useEntityTimeline(baseUrl || null, connectUrl)
  // Only expose the reply affordance when the entity type declares comments —
  // the native shell always passes the callback, so gate it here (mirrors
  // desktop GenericChatBody's `onReplyToRow={showComments ? ... : undefined}`).
  const replyToComment = commentsEnabled ? onReplyToComment : undefined
  const canFork = useEntityPermission(entity, `fork`)
  const navigate = useNavigate()
  // `onCommentTargetClick` jumps from a reply's snapshot to the original row.
  // The embed router stubs out navigation, so we track the focus target locally.
  const [focusTarget, setFocusTarget] = useState<CommentTarget | null>(null)
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
  // Optimistic comments not yet present in the timeline (deduped by key against
  // comments already synced), so a posted comment renders before the stream
  // catches up. `~pending` orders keep them in the same bottom band the shared
  // query uses, so ordering still matches desktop.
  const projectedComments = useMemo<Array<TimelineRow>>(() => {
    if (inlineComments.length === 0) return []
    const syncedKeys = new Set(
      timelineRows.filter((row) => row.comment).map((row) => row.comment!.key)
    )
    return inlineComments
      .filter((comment) => !syncedKeys.has(comment.key))
      .map(
        (comment) =>
          ({ $key: `pending-comment:${comment.key}`, comment }) as TimelineRow
      )
  }, [inlineComments, timelineRows])

  const visibleRows = useMemo<Array<TimelineRow>>(() => {
    const base = projectedPendingMessage
      ? [
          ...timelineRows,
          {
            $key: `pending-inbox:${projectedPendingMessage.key}`,
            inbox: projectedPendingMessage,
          } as TimelineRow,
        ]
      : timelineRows
    return projectedComments.length > 0 ? [...base, ...projectedComments] : base
  }, [projectedPendingMessage, timelineRows, projectedComments])

  useEffect(() => {
    if (error && !isSpawning) {
      void navigate({ to: `/` })
    }
  }, [error, navigate, isSpawning])

  const forkFromHereByRunKey = useForkFromHere({
    rows: visibleRows,
    db,
    entityUrl: connectUrl,
    canFork,
  })

  const commentsTimeline = useMemo(
    () => (commentsOnly ? buildCommentsTimeline(visibleRows) : null),
    [commentsOnly, visibleRows]
  )

  return (
    <EntityTimeline
      rows={commentsTimeline ? commentsTimeline.rows : visibleRows}
      rowAdjacency={commentsTimeline?.adjacency}
      loading={loading}
      error={error}
      entityStopped={entityStopped}
      baseUrl={baseUrl}
      cacheKey={`${baseUrl}${connectUrl ?? ``}:${commentsOnly ? `comments` : `chat`}:${scrollToBottomSignal ?? 0}`}
      tileId={tileId}
      entityUrl={connectUrl}
      entities={entities}
      scrollToBottomSignal={scrollToBottomSignal}
      forkFromHereByRunKey={commentsOnly ? undefined : forkFromHereByRunKey}
      onReplyToRow={replyToComment}
      onCommentTargetClick={replyToComment ? setFocusTarget : undefined}
      focusTarget={focusTarget}
      onFocusTargetHandled={() => setFocusTarget(null)}
    />
  )
}

export function CommentsView({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  isSpawning,
  tileId,
}: ViewProps): React.ReactElement {
  const connectUrl = isSpawning ? null : entityUrl
  const { timelineRows, entities, db, loading, error } = useEntityTimeline(
    baseUrl || null,
    connectUrl
  )
  const navigate = useNavigate()
  const { helpers } = useWorkspace()
  const canWrite = useEntityPermission(entity, `write`)
  const [sentCommentSignal, setSentCommentSignal] = useState(0)
  const [selectedCommentTarget, setSelectedCommentTarget] =
    useState<SelectedCommentTarget | null>(null)
  const commentsTimeline = useMemo(
    () => buildCommentsTimeline(timelineRows),
    [timelineRows]
  )

  useEffect(() => {
    if (error && !isSpawning) {
      void navigate({ to: `/` })
    }
  }, [error, navigate, isSpawning])

  useEffect(() => {
    setSelectedCommentTarget(null)
  }, [connectUrl])

  const openFullTimelineTarget = useCallback(
    (target: CommentTarget) => {
      helpers.setTileView(tileId, `chat`, {
        viewParams: commentFocusViewParams(target),
      })
    },
    [helpers, tileId]
  )

  return (
    <>
      <EntityTimeline
        rows={commentsTimeline.rows}
        rowAdjacency={commentsTimeline.adjacency}
        loading={loading}
        error={error}
        entityStopped={entityStopped}
        baseUrl={baseUrl}
        cacheKey={`${baseUrl}${connectUrl ?? ``}:comments-view`}
        tileId={tileId}
        entityUrl={connectUrl}
        entities={entities}
        scrollToBottomSignal={sentCommentSignal}
        onReplyToRow={setSelectedCommentTarget}
        onCommentTargetClick={openFullTimelineTarget}
      />
      <MessageInput
        db={db}
        baseUrl={baseUrl}
        entityUrl={connectUrl ?? ``}
        disabled={entityStopped || !db}
        writeDisabled={!canWrite}
        disabledPlaceholder={!canWrite ? `Read-only` : undefined}
        imageAttachmentsEnabled={false}
        defaultMode="comment"
        commentOnly
        commentTarget={selectedCommentTarget}
        onClearCommentTarget={() => setSelectedCommentTarget(null)}
        onSend={() => setSentCommentSignal((value) => value + 1)}
      />
    </>
  )
}

function GenericChatBody({
  baseUrl,
  entityUrl,
  entity,
  entityStopped,
  isSpawning,
  tileId,
  viewParams,
}: {
  baseUrl: string
  entityUrl: string | null
  entity: ViewProps[`entity`]
  entityStopped: boolean
  isSpawning: boolean
  tileId: string
  viewParams?: ViewProps[`viewParams`]
}): React.ReactElement {
  const {
    timelineRows,
    pendingInbox,
    entities,
    generationActive,
    db,
    loading,
    error,
    commentsEnabled,
  } = useEntityTimeline(baseUrl || null, entityUrl, {
    comments: viewParams?.comments !== `hidden`,
  })
  const showComments = commentsEnabled && viewParams?.comments !== `hidden`
  const { signalEntity, entityTypesCollection } = useElectricAgents()
  const permissions = useEntityPermissions(entity, CHAT_VIEW_PERMISSIONS)
  const canWrite = permissions.write
  const canSignal = permissions.signal
  const canFork = permissions.fork
  const navigate = useNavigate()
  const { helpers } = useWorkspace()
  const [sentMessageSignal, setSentMessageSignal] = useState(0)
  const [stopPending, setStopPending] = useState(false)
  const [selectedCommentTarget, setSelectedCommentTarget] =
    useState<SelectedCommentTarget | null>(null)
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
  const timelineRowsWithInlinePending = useMemo<Array<TimelineRow>>(
    () =>
      inlinePendingInbox
        ? [
            ...timelineRows,
            {
              $key: `pending-inbox:${inlinePendingInbox.key}`,
              inbox: inlinePendingInbox,
            } as TimelineRow,
          ]
        : timelineRows,
    [inlinePendingInbox, timelineRows]
  )
  const focusTarget = useMemo(
    () => decodeCommentTargetParam(viewParams?.[COMMENT_FOCUS_PARAM]),
    [viewParams]
  )
  const clearFocusTarget = useCallback(() => {
    if (!viewParams?.[COMMENT_FOCUS_PARAM]) return
    const nextParams = { ...viewParams }
    delete nextParams[COMMENT_FOCUS_PARAM]
    helpers.setTileView(tileId, `chat`, {
      viewParams: Object.keys(nextParams).length > 0 ? nextParams : undefined,
    })
  }, [helpers, tileId, viewParams])
  useEffect(() => {
    if (!showComments) setSelectedCommentTarget(null)
  }, [showComments])
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

  const forkFromHereByRunKey = useForkFromHere({
    rows: timelineRowsWithInlinePending,
    db,
    entityUrl,
    canFork,
  })

  return (
    <>
      <GoalBanner db={db} />
      <EntityTimeline
        rows={timelineRowsWithInlinePending}
        loading={loading}
        error={error}
        entityStopped={entityStopped}
        baseUrl={baseUrl}
        cacheKey={`${baseUrl}${entityUrl ?? ``}:comments:${showComments ? `shown` : `hidden`}`}
        tileId={tileId}
        entityUrl={entityUrl}
        entities={entities}
        scrollToBottomSignal={sentMessageSignal}
        onStopGeneration={stopGeneration}
        stopPending={stopPending}
        forkFromHereByRunKey={forkFromHereByRunKey}
        onReplyToRow={showComments ? setSelectedCommentTarget : undefined}
        focusTarget={focusTarget}
        onFocusTargetHandled={clearFocusTarget}
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
        commentTarget={showComments ? selectedCommentTarget : null}
        onClearCommentTarget={() => setSelectedCommentTarget(null)}
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
