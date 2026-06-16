import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ScrollView,
  TextInput,
  View,
  type KeyboardEvent,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { eq, inArray } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useEntityTimeline } from '@electric-ax/agents-server-ui/src/hooks/useEntityTimeline'
import {
  createDeleteInboxMessageAction,
  createQueuePositionBetween,
  createSendComposerInputAction,
  createSteerInboxMessageAction,
  createUpdateInboxMessageAction,
  readTextPayload,
} from '@electric-ax/agents-server-ui/src/lib/sendMessage'
import type { OptimisticInboxMessage } from '@electric-ax/agents-server-ui/src/lib/sendMessage'
import { createSendCommentAction } from '@electric-ax/agents-server-ui/src/lib/comments'
import type { SelectedCommentTarget } from '@electric-ax/agents-server-ui/src/lib/comments'
import { serializeComposerInput } from '@electric-ax/agents-runtime/client'
import type {
  EntityTimelineQueryRow,
  SlashCommandRow,
} from '@electric-ax/agents-runtime/client'
import { schemaModelSupportsImageInput } from '@electric-ax/agents-server-ui/src/lib/modelCapabilities'
import { Header, HeaderBackButton } from '../components/Header'
import { Icon } from '../components/Icon'
import {
  AttachButton,
  AttachmentTray,
  renderComposerHighlights,
  SlashCommandMenu,
  useSlashAutocomplete,
} from '../components/NativeComposer'
import { useAttachmentDrafts } from '../lib/attachments'
import { Screen } from '../components/Screen'
import { SessionMenu } from '../components/SessionMenu'
import { StatusDot } from '../components/StatusDot'
import { TopBarIconButton } from '../components/TopBarIconButton'
import { useAgents } from '../lib/AgentsProvider'
import { getEntityDisplayTitle } from '../lib/agentsClient'
import {
  useEntityPermissions,
  type EntityPermission,
} from '../lib/useEntityPermissions'
import { useCurrentPrincipal } from '../lib/useCurrentPrincipal'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'
import type { EmbedViewId } from '../lib/embedView'
import type { ElectricEntity, EntitySignal } from '../lib/agentsClient'

export const CHAT_COMPOSER_BASE_HEIGHT = 76
export const CHAT_COMPOSER_OVERLAP = 20

// Match the send/attach button height so a single line of text sits centered
// alongside the buttons (with `paddingVertical` below) rather than floating
// above them.
const COMPOSER_INPUT_MIN_HEIGHT = 34
const COMPOSER_INPUT_MAX_HEIGHT = 200
const INLINE_QUEUED_TIMEOUT_MS = 15_000
const SESSION_PERMISSIONS: ReadonlyArray<EntityPermission> = [`write`, `signal`]

type EntityStreamState = ReturnType<typeof useEntityTimeline>
type EntityStreamDB = EntityStreamState[`db`]
type PendingInboxMessage = EntityStreamState[`pendingInbox`][number]

export function ChatSessionScreen({
  entityUrl,
  view = `chat`,
  onBack,
  onSetView,
  onOpenEntity,
  onOpenStateSource,
  onComposerHeightChange,
  onSendMessage,
  onInlineQueuedMessagesChange,
  onShare,
  commentTarget,
  onClearCommentTarget,
}: {
  entityUrl: string
  /** `chat` (default) or the comments-only `comments` view. */
  view?: EmbedViewId
  onBack: () => void
  onSetView: (view: EmbedViewId) => void
  onOpenEntity: (entityUrl: string) => void
  onOpenStateSource: (sourceId: string) => void
  onComposerHeightChange: (height: number) => void
  onSendMessage: () => void
  onInlineQueuedMessagesChange?: (
    messages: Array<OptimisticInboxMessage>
  ) => void
  onShare?: () => void
  commentTarget?: SelectedCommentTarget | null
  onClearCommentTarget?: () => void
}): React.ReactElement {
  return (
    <SessionScreen
      entityUrl={entityUrl}
      view={view}
      onBack={onBack}
      onSetView={onSetView}
      onOpenEntity={onOpenEntity}
      onOpenStateSource={onOpenStateSource}
      onComposerHeightChange={onComposerHeightChange}
      onSendMessage={onSendMessage}
      onInlineQueuedMessagesChange={onInlineQueuedMessagesChange}
      onShare={onShare}
      commentTarget={commentTarget}
      onClearCommentTarget={onClearCommentTarget}
    />
  )
}

export function StateInspectorSessionScreen({
  entityUrl,
  onBack,
  onSetView,
  onShare,
}: {
  entityUrl: string
  onBack: () => void
  onSetView: (view: EmbedViewId) => void
  onShare?: () => void
}): React.ReactElement {
  return (
    <SessionScreen
      entityUrl={entityUrl}
      view="state-explorer"
      onBack={onBack}
      onSetView={onSetView}
      onShare={onShare}
    />
  )
}

/**
 * Native chrome for an active session. This screen contributes the
 * safe-area top inset, an iOS-style `<Header>` (back chevron, centered
 * title, kebab), and a keyboard-anchored native composer.
 *
 * View toggling (chat ↔ state explorer) used to live in the toolbar
 * as `<IconToggle>`s; we moved it into the kebab `<SessionMenu>` so
 * the toolbar matches a stock chat-app pattern (← title …).
 */
export function SessionScreen({
  entityUrl,
  view,
  onBack,
  onSetView,
  onOpenEntity,
  onOpenStateSource,
  onComposerHeightChange,
  onSendMessage,
  onInlineQueuedMessagesChange,
  onShare,
  commentTarget = null,
  onClearCommentTarget,
}: {
  entityUrl: string
  view: EmbedViewId
  onBack: () => void
  onSetView: (view: EmbedViewId) => void
  onOpenEntity?: (entityUrl: string) => void
  onOpenStateSource?: (sourceId: string) => void
  onComposerHeightChange?: (height: number) => void
  onSendMessage?: () => void
  onInlineQueuedMessagesChange?: (
    messages: Array<OptimisticInboxMessage>
  ) => void
  onShare?: () => void
  /** Reply target forwarded from the embed timeline (chat + comments views). */
  commentTarget?: SelectedCommentTarget | null
  onClearCommentTarget?: () => void
}): React.ReactElement {
  const commentOnly = view === `comments`
  const { entitiesCollection, serverUrl, signalEntity } = useAgents()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const [menuOpen, setMenuOpen] = useState(false)
  const [inlineQueuedMessages, setInlineQueuedMessages] = useState<
    Map<string, OptimisticInboxMessage>
  >(() => new Map())
  const [stopPending, setStopPending] = useState(false)
  const [signalError, setSignalError] = useState<string | null>(null)
  const inlineQueuedKeysRef = useRef(new Set<string>())
  const inlineTimeoutsRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  )

  const { data: matches = [] } = useLiveQuery(
    (query) =>
      query
        .from({ entity: entitiesCollection })
        .where(({ entity }) => eq(entity.url, entityUrl)),
    [entitiesCollection, entityUrl]
  )
  const entity = matches.at(0) ?? null
  const permissions = useEntityPermissions(entity, SESSION_PERMISSIONS)
  const canWrite = permissions.write
  const canSignal = permissions.signal
  const streamEntityUrl =
    view !== `state-explorer` && entity?.status !== `spawning`
      ? entityUrl
      : null
  const { timelineRows, pendingInbox, db, generationActive, commentsEnabled } =
    useEntityTimeline(serverUrl, streamEntityUrl)
  const manifests = useMemo(
    () =>
      timelineRows
        .filter((row): row is EntityTimelineQueryRow & { manifest: object } =>
          Boolean(row.manifest)
        )
        .map((row) => row.manifest as ManifestRecord),
    [timelineRows]
  )
  const processedInboxKeySignature = useMemo(
    () =>
      timelineRows
        .filter((row) => row.inbox)
        .map((row) => row.inbox!.key)
        .join(`\0`),
    [timelineRows]
  )
  const processedInboxKeys = useMemo(
    () =>
      new Set(
        processedInboxKeySignature ? processedInboxKeySignature.split(`\0`) : []
      ),
    [processedInboxKeySignature]
  )
  const pendingInboxByKey = useMemo(
    () => new Map(pendingInbox.map((message) => [message.key, message])),
    [pendingInbox]
  )
  const projectedPendingMessage = useMemo(() => {
    if (entity?.status === `running`) return null
    for (const [key, message] of inlineQueuedMessages) {
      if (processedInboxKeys.has(key)) continue
      return pendingInboxByKey.get(key) ?? message
    }
    return null
  }, [
    entity?.status,
    inlineQueuedMessages,
    pendingInboxByKey,
    processedInboxKeys,
  ])
  const visiblePendingInbox = useMemo(
    () =>
      pendingInbox.filter((message) => {
        if (projectedPendingMessage?.key === message.key) return false
        return !inlineQueuedKeysRef.current.has(message.key)
      }),
    [pendingInbox, projectedPendingMessage]
  )
  const inlineQueuedSubmits =
    entity?.status !== `running` &&
    pendingInbox.length === 0 &&
    inlineQueuedMessages.size === 0

  const rememberInlineQueuedMessage = useCallback(
    (message: OptimisticInboxMessage): void => {
      inlineQueuedKeysRef.current.add(message.key)
      setInlineQueuedMessages((current) => {
        const next = new Map(current)
        next.set(message.key, message)
        return next
      })
      const existingTimeout = inlineTimeoutsRef.current.get(message.key)
      if (existingTimeout) clearTimeout(existingTimeout)
      const timeout = setTimeout(() => {
        inlineQueuedKeysRef.current.delete(message.key)
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
    if (inlineQueuedMessages.size === 0) return
    setInlineQueuedMessages((current) => {
      let next: Map<string, OptimisticInboxMessage> | null = null
      for (const key of current.keys()) {
        if (!processedInboxKeys.has(key)) continue
        next ??= new Map(current)
        next.delete(key)
        inlineQueuedKeysRef.current.delete(key)
        const timeout = inlineTimeoutsRef.current.get(key)
        if (timeout) clearTimeout(timeout)
        inlineTimeoutsRef.current.delete(key)
      }
      return next ?? current
    })
  }, [inlineQueuedMessages.size, processedInboxKeys])

  useEffect(
    () => () => {
      inlineQueuedKeysRef.current.clear()
      for (const timeout of inlineTimeoutsRef.current.values()) {
        clearTimeout(timeout)
      }
      inlineTimeoutsRef.current.clear()
    },
    []
  )

  useEffect(() => {
    onInlineQueuedMessagesChange?.(Array.from(inlineQueuedMessages.values()))
  }, [inlineQueuedMessages, onInlineQueuedMessagesChange])

  useEffect(() => {
    if (!generationActive) setStopPending(false)
  }, [generationActive])

  useEffect(() => {
    setStopPending(false)
    setSignalError(null)
  }, [entityUrl])

  const sendSignal = useCallback(
    async (
      signal: EntitySignal,
      reason: string,
      opts: { stopPending?: boolean } = {}
    ): Promise<void> => {
      if (!entity) return
      if (!canSignal) return
      if (opts.stopPending) setStopPending(true)
      setSignalError(null)
      try {
        await signalEntity({ entityUrl, signal, reason })
      } catch (err) {
        if (opts.stopPending) setStopPending(false)
        setSignalError(err instanceof Error ? err.message : String(err))
      }
    },
    [canSignal, entity, entityUrl, signalEntity]
  )

  const stopGeneration = useCallback((): void => {
    if (!canSignal || !generationActive || stopPending) return
    void sendSignal(`SIGINT`, `Stopped from mobile chat UI`, {
      stopPending: true,
    })
  }, [canSignal, generationActive, sendSignal, stopPending])

  const stopImmediately = useCallback(async (): Promise<void> => {
    if (!entity) return
    if (!canSignal) return
    setSignalError(null)
    try {
      await signalEntity({
        entityUrl,
        signal: `SIGSTOP`,
        reason: `Stopped immediately from mobile session menu`,
      })
      await signalEntity({
        entityUrl,
        signal: `SIGINT`,
        reason: `Interrupted current run for immediate stop`,
      })
    } catch (err) {
      setSignalError(err instanceof Error ? err.message : String(err))
    }
  }, [canSignal, entity, entityUrl, signalEntity])

  const sendMenuSignal = useCallback(
    (signal: EntitySignal): void => {
      if (!canSignal) return
      void sendSignal(signal, `Sent from mobile session menu`)
    },
    [canSignal, sendSignal]
  )

  const title = entity
    ? getEntityDisplayTitle(entity)
    : decodeURIComponent(entityUrl.replace(/^\//, ``))

  return (
    <Screen style={styles.screen} pointerEvents="box-none">
      <Header
        align="center"
        leading={<HeaderBackButton onPress={onBack} />}
        title={title}
        actions={
          <TopBarIconButton
            icon="more"
            onPress={() => setMenuOpen(true)}
            accessibilityLabel="Session options"
          />
        }
      />

      <View pointerEvents="none" style={styles.bodyFill} />
      {view !== `state-explorer` && (
        <NativeMessageComposer
          entityUrl={entityUrl}
          entity={entity}
          db={db}
          pendingMessages={visiblePendingInbox}
          manifests={manifests}
          inlineQueuedSubmits={inlineQueuedSubmits}
          onHeightChange={onComposerHeightChange}
          onSendMessage={onSendMessage}
          onOptimisticQueuedMessage={rememberInlineQueuedMessage}
          onOpenEntity={onOpenEntity}
          onOpenStateSource={onOpenStateSource}
          generationActive={generationActive}
          stopPending={stopPending}
          onStop={stopGeneration}
          writeDisabled={!canWrite}
          stopDisabled={!canSignal}
          commentsEnabled={commentsEnabled}
          commentOnly={commentOnly}
          commentTarget={commentTarget}
          onClearCommentTarget={onClearCommentTarget}
          disabled={
            !db ||
            entity?.status === `stopped` ||
            entity?.status === `killed` ||
            entity?.status === `spawning`
          }
          placeholder={
            entity?.status === `stopped`
              ? `Entity stopped`
              : entity?.status === `killed`
                ? `Entity killed`
                : entity?.status === `spawning`
                  ? `Starting...`
                  : !db
                    ? `Connecting...`
                    : !canWrite
                      ? `Read-only`
                      : `Send a message...`
          }
        />
      )}

      <SessionMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        entity={entity}
        view={view}
        onSetView={onSetView}
        commentsEnabled={commentsEnabled}
        signalError={signalError}
        onSignal={sendMenuSignal}
        onStopImmediately={() => void stopImmediately()}
        onShare={onShare}
        signalDisabled={!canSignal}
      />
    </Screen>
  )
}

// Mirrors agents-server-ui MessageInput's reply-banner label.
function formatReplyBannerLabel(target: SelectedCommentTarget): string {
  const label = target.snapshot.label.trim()
  if (!label) return `Reply`
  return `Reply to ${label.charAt(0).toLowerCase()}${label.slice(1)}`
}

function NativeMessageComposer({
  entityUrl,
  entity,
  db,
  pendingMessages,
  manifests,
  inlineQueuedSubmits,
  onHeightChange,
  onSendMessage,
  onOptimisticQueuedMessage,
  onOpenEntity,
  onOpenStateSource,
  generationActive,
  stopPending,
  onStop,
  writeDisabled,
  stopDisabled,
  commentsEnabled,
  commentOnly,
  commentTarget,
  onClearCommentTarget,
  disabled,
  placeholder,
}: {
  entityUrl: string
  entity: ElectricEntity | null
  db: EntityStreamDB
  pendingMessages: Array<PendingInboxMessage>
  manifests: Array<ManifestRecord>
  inlineQueuedSubmits: boolean
  onHeightChange?: (height: number) => void
  onSendMessage?: () => void
  onOptimisticQueuedMessage?: (message: OptimisticInboxMessage) => void
  onOpenEntity?: (entityUrl: string) => void
  onOpenStateSource?: (sourceId: string) => void
  generationActive: boolean
  stopPending: boolean
  onStop: () => void
  writeDisabled: boolean
  stopDisabled: boolean
  /** Entity type declares the comments collection — enables the comment toggle. */
  commentsEnabled: boolean
  /** Comments-only view: lock the composer to comment mode, hide the toggle. */
  commentOnly: boolean
  /** Reply target forwarded from the embed timeline. */
  commentTarget: SelectedCommentTarget | null
  onClearCommentTarget?: () => void
  disabled: boolean
  placeholder: string
}): React.ReactElement {
  const { serverUrl, entityTypesCollection } = useAgents()
  const { principal } = useCurrentPrincipal()
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => createComposerStyles(tokens), [tokens])
  const { keyboardVisible, keyboardTranslateY } = useKeyboardAttachment()
  const inputRef = useRef<TextInput>(null)
  const [value, setValue] = useState(``)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<`prompt` | `comment`>(
    commentOnly ? `comment` : `prompt`
  )
  const [editingMessage, setEditingMessage] = useState<{
    key: string
  } | null>(null)
  // A reply target (from tapping a timeline row) or the comments-only view
  // forces comment mode; focus the input so the user can type immediately.
  useEffect(() => {
    if (commentTarget) {
      setMode(`comment`)
      inputRef.current?.focus()
    }
  }, [commentTarget])
  useEffect(() => {
    if (commentOnly) setMode(`comment`)
  }, [commentOnly])
  // If the entity loses comment support (or write access), fall back to prompt.
  useEffect(() => {
    if (!commentOnly && (!commentsEnabled || writeDisabled)) setMode(`prompt`)
  }, [commentOnly, commentsEnabled, writeDisabled])
  const commentMode = mode === `comment`
  const showCommentToggle = commentsEnabled && !commentOnly && !editingMessage
  const attachmentsAllowed = !commentMode
  const text = value.trim()
  const bottomPadding = keyboardVisible ? 4 : Math.max(insets.bottom, 8)
  // The per-entity slashCommands collection only carries dynamically-registered
  // commands — statically-declared ones are never materialised into it. So, like
  // the desktop composer (ChatView -> MessageInput), fall back to the entity
  // type's declarations when the live collection is empty.
  const { data: liveSlashCommands = [] } = useLiveQuery(
    (q) =>
      db
        ? q
            .from({ slashCommand: db.collections.slashCommands as any })
            .orderBy(({ slashCommand }: any) => slashCommand.name, `asc`)
        : undefined,
    [db]
  )
  const { data: matchingTypes = [] } = useLiveQuery(
    (q) =>
      entity
        ? q
            .from({ type: entityTypesCollection })
            .where(({ type }) => eq(type.name, entity.type))
        : undefined,
    [entityTypesCollection, entity?.type]
  )
  const slashCommands = useMemo<Array<SlashCommandRow>>(() => {
    if (liveSlashCommands.length > 0) {
      return liveSlashCommands as Array<SlashCommandRow>
    }
    return (matchingTypes[0]?.slash_commands ?? []).map((command) => ({
      ...command,
      key: `static:${command.name}`,
      source: `static`,
      updated_at: matchingTypes[0]?.updated_at ?? ``,
    }))
  }, [liveSlashCommands, matchingTypes])
  const attach = useAttachmentDrafts()
  // Gate the attach affordance on whether the session's model accepts images,
  // mirroring the desktop composer.
  const imageInputSupported = useMemo(
    () =>
      schemaModelSupportsImageInput(
        matchingTypes[0]?.creation_schema,
        entity?.spawn_args ?? {}
      ),
    [matchingTypes, entity?.spawn_args]
  )
  const showAttach =
    imageInputSupported &&
    attach.supported &&
    !editingMessage &&
    attachmentsAllowed
  useEffect(() => {
    if (!imageInputSupported || commentMode) attach.clear()
  }, [imageInputSupported, commentMode, attach.clear])
  const hasDraftAttachments =
    attach.drafts.length > 0 && !editingMessage && attachmentsAllowed
  const sendAction = useMemo(() => {
    if (!db) return null
    return createSendComposerInputAction({
      db,
      baseUrl: serverUrl,
      entityUrl,
      onOptimisticMessage: (message) => {
        if (inlineQueuedSubmits && message.mode === `queued`) {
          onOptimisticQueuedMessage?.(message)
        }
      },
    })
  }, [db, entityUrl, inlineQueuedSubmits, onOptimisticQueuedMessage, serverUrl])
  // NOTE: unlike desktop, the composer (native) and the timeline (WebView
  // embed) run in separate JS contexts with separate stream `db`s, so the
  // optimistic row this inserts into the native `db.collections.comments`
  // isn't rendered — the comment appears once the embed's stream syncs it
  // from the server. Queued messages bridge this via `inlineQueuedMessages`;
  // an equivalent comment bridge is a follow-up. The POST + sync are correct.
  const sendCommentAction = useMemo(() => {
    if (!db || !commentsEnabled) return null
    return createSendCommentAction({
      db,
      baseUrl: serverUrl,
      entityUrl,
      from: principal,
    })
  }, [db, commentsEnabled, serverUrl, entityUrl, principal])
  const updateAction = useMemo(() => {
    if (!db) return null
    return createUpdateInboxMessageAction({ db, baseUrl: serverUrl, entityUrl })
  }, [db, serverUrl, entityUrl])
  const deleteAction = useMemo(() => {
    if (!db) return null
    return createDeleteInboxMessageAction({ db, baseUrl: serverUrl, entityUrl })
  }, [db, serverUrl, entityUrl])
  const steerAction = useMemo(() => {
    if (!db) return null
    return createSteerInboxMessageAction({ db, baseUrl: serverUrl, entityUrl })
  }, [db, serverUrl, entityUrl])
  const showStop =
    generationActive &&
    text.length === 0 &&
    !hasDraftAttachments &&
    !disabled &&
    !editingMessage
  const canStop = showStop && !stopPending && !stopDisabled
  const canSend =
    (text.length > 0 || hasDraftAttachments) &&
    !disabled &&
    !writeDisabled &&
    !sending
  const inputDisabled = disabled || writeDisabled || sending
  const composerDisabled = disabled || (writeDisabled && !showStop)
  const slash = useSlashAutocomplete(value, slashCommands, {
    enabled: !inputDisabled && !commentMode,
  })
  // Controls the caret for one render after a programmatic command insert, then
  // releases back to uncontrolled so normal typing isn't fought.
  const [pendingSelection, setPendingSelection] = useState<{
    start: number
    end: number
  } | null>(null)
  const insertSlashCommand = (command: SlashCommandRow): void => {
    const insertion = slash.applyCommand(command)
    setValue(insertion.value)
    setPendingSelection(insertion.selection)
  }

  const finishPersistedAction = (promise: Promise<unknown>): void => {
    promise
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => {
        setSending(false)
      })
  }

  const send = (): void => {
    if (!canSend) return

    setSending(true)
    setError(null)

    if (commentMode) {
      const tx = sendCommentAction?.({
        body: text,
        ...(commentTarget
          ? {
              replyTo: commentTarget.target,
              targetSnapshot: commentTarget.snapshot,
            }
          : {}),
      })
      if (!tx) {
        setSending(false)
        return
      }

      setValue(``)
      setPendingSelection(null)
      slash.reset()
      onClearCommentTarget?.()
      onSendMessage?.()
      finishPersistedAction(tx.isPersisted.promise)
      return
    }

    if (editingMessage) {
      const tx = updateAction?.({
        key: editingMessage.key,
        text,
        mode: `queued`,
        status: `pending`,
      })
      if (!tx) {
        setSending(false)
        return
      }

      setValue(``)
      setPendingSelection(null)
      slash.reset()
      setEditingMessage(null)
      onSendMessage?.()
      finishPersistedAction(tx.isPersisted.promise)
      return
    }

    const tx = sendAction?.({
      payload: serializeComposerInput(text, slashCommands),
      mode: `queued`,
      attachments: hasDraftAttachments ? attach.drafts : undefined,
    })
    if (!tx) {
      setSending(false)
      return
    }

    setValue(``)
    setPendingSelection(null)
    slash.reset()
    setEditingMessage(null)
    attach.clear()
    onSendMessage?.()
    finishPersistedAction(tx.isPersisted.promise)
  }

  const handleComposerAction = (): void => {
    if (showStop) {
      if (canStop) onStop()
      return
    }
    send()
  }

  const startEditing = useCallback(
    (message: PendingInboxMessage): void => {
      if (disabled || writeDisabled) return
      const queuedText = readTextPayload(message.payload)
      setError(null)
      // Editing is a prompt-mode action; leave comment mode so `send()`'s
      // comment branch can't hijack the edit (mirrors desktop `startEditing`).
      if (!commentOnly) setMode(`prompt`)
      updateAction?.({
        key: message.key,
        mode: `paused`,
        status: `pending`,
      }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      setEditingMessage({ key: message.key })
      setValue(queuedText)
      setPendingSelection(null)
      slash.reset()
    },
    [commentOnly, disabled, slash.reset, updateAction, writeDisabled]
  )

  const cancelEditing = useCallback((): void => {
    if (editingMessage) {
      setError(null)
      updateAction?.({
        key: editingMessage.key,
        mode: `queued`,
        status: `pending`,
      }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
    }
    setEditingMessage(null)
    setValue(``)
    setPendingSelection(null)
    slash.reset()
  }, [editingMessage, slash.reset, updateAction])

  const deleteMessage = useCallback(
    (key: string): void => {
      if (disabled || writeDisabled) return
      setError(null)
      deleteAction?.({ key }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      if (editingMessage?.key === key) cancelEditing()
    },
    [cancelEditing, deleteAction, disabled, editingMessage?.key, writeDisabled]
  )

  const steerMessage = useCallback(
    (key: string): void => {
      if (disabled || writeDisabled) return
      setError(null)
      steerAction?.({ key }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      if (editingMessage?.key === key) cancelEditing()
      onSendMessage?.()
    },
    [
      cancelEditing,
      disabled,
      editingMessage?.key,
      onSendMessage,
      steerAction,
      writeDisabled,
    ]
  )

  const reorderMessage = useCallback(
    (key: string, position: string): void => {
      if (disabled || writeDisabled) return
      setError(null)
      updateAction?.({ key, position }).isPersisted.promise.catch(
        (err: Error) => {
          setError(err.message)
        }
      )
    },
    [disabled, updateAction, writeDisabled]
  )

  return (
    <Animated.View
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      style={[
        styles.root,
        {
          paddingBottom: bottomPadding,
          // Android's window resizes for the IME, which already lifts this
          // bottom-anchored card above the keyboard; applying the translate
          // there too would double the offset. iOS doesn't resize, so there the
          // translate does the work.
          transform: [
            { translateY: Platform.OS === `android` ? 0 : keyboardTranslateY },
          ],
        },
      ]}
    >
      {error && <Text style={styles.error}>{error}</Text>}
      {showCommentToggle && (
        <View style={styles.modeToggle}>
          <Pressable
            onPress={() => setMode(`prompt`)}
            accessibilityRole="button"
            accessibilityState={{ selected: !commentMode }}
            style={[styles.modeButton, !commentMode && styles.modeButtonActive]}
          >
            <Text
              style={[
                styles.modeButtonText,
                !commentMode && styles.modeButtonTextActive,
              ]}
            >
              Message
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode(`comment`)}
            accessibilityRole="button"
            accessibilityState={{ selected: commentMode }}
            style={[styles.modeButton, commentMode && styles.modeButtonActive]}
          >
            <Text
              style={[
                styles.modeButtonText,
                commentMode && styles.modeButtonTextActive,
              ]}
            >
              Comment
            </Text>
          </Pressable>
        </View>
      )}
      {commentMode && commentTarget && (
        <View style={styles.replyBanner}>
          <View style={styles.replyBannerBody}>
            <Text style={styles.replyLabel} numberOfLines={1}>
              {formatReplyBannerLabel(commentTarget)}
            </Text>
            {commentTarget.snapshot.text ? (
              <Text style={styles.replyText} numberOfLines={1}>
                {commentTarget.snapshot.text}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => onClearCommentTarget?.()}
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
            hitSlop={8}
          >
            <Icon name="close" size={16} color={tokens.text3} strokeWidth={2} />
          </Pressable>
        </View>
      )}
      {entity && !commentOnly && (
        <NativeEntityContextDrawer
          entity={entity}
          pendingMessages={pendingMessages}
          manifests={manifests}
          editingKey={editingMessage?.key ?? null}
          onEditPending={startEditing}
          onDeletePending={deleteMessage}
          onSteerPending={steerMessage}
          onReorderPending={reorderMessage}
          onOpenEntity={onOpenEntity}
          onOpenStateSource={onOpenStateSource}
          pendingActionsDisabled={disabled || writeDisabled}
        />
      )}
      {editingMessage && (
        <View style={styles.editingBanner}>
          <Text style={styles.editingText}>Editing queued message</Text>
          <Pressable
            onPress={cancelEditing}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing queued message"
            hitSlop={8}
          >
            <Text style={styles.editingCancel}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {slash.open && (
        <SlashCommandMenu items={slash.items} onSelect={insertSlashCommand} />
      )}
      {showAttach && (
        <AttachmentTray drafts={attach.drafts} onRemove={attach.remove} />
      )}
      <View
        style={[styles.composer, composerDisabled ? styles.disabled : null]}
      >
        {showAttach && (
          <AttachButton
            onAddFromLibrary={() => void attach.addFromLibrary()}
            onAddFromCamera={() => void attach.addFromCamera()}
            disabled={inputDisabled}
          />
        )}
        <TextInput
          ref={inputRef}
          onChangeText={setValue}
          onSelectionChange={(event) => {
            slash.onSelectionChange(event)
            if (pendingSelection) setPendingSelection(null)
          }}
          selection={pendingSelection ?? undefined}
          editable={!inputDisabled}
          multiline
          placeholder={
            commentMode && !inputDisabled ? `Add a comment...` : placeholder
          }
          placeholderTextColor={tokens.text4}
          // Size to content intrinsically (within the style's min/maxHeight)
          // rather than via onContentSizeChange — that callback never fires when
          // the text is supplied as child <Text> instead of `value` (RN #13732),
          // so the input wouldn't grow on iOS. The root onLayout reports the
          // resulting card height to the timeline embed.
          style={styles.input}
          returnKeyType="default"
        >
          {renderComposerHighlights(value, slashCommands, {
            base: styles.baseText,
            command: styles.commandToken,
            arg: styles.argToken,
          })}
        </TextInput>
        <Pressable
          onPress={handleComposerAction}
          disabled={showStop ? stopPending : !canSend}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            showStop
              ? `Stop generating`
              : commentMode
                ? `Post comment`
                : `Send message`
          }
          style={({ pressed }) => [
            styles.sendButton,
            canSend || canStop ? styles.sendButtonActive : null,
            showStop ? styles.stopButton : null,
            showStop && stopPending ? styles.stopButtonPending : null,
            pressed && (canSend || canStop) ? styles.sendButtonPressed : null,
          ]}
        >
          {sending && !showStop ? (
            <ActivityIndicator size="small" color={tokens.textOnAccent} />
          ) : (
            <Icon
              name={showStop ? `square` : `arrow-up`}
              size={showStop ? 14 : 18}
              color={canSend || canStop ? tokens.textOnAccent : tokens.text4}
              strokeWidth={2.4}
            />
          )}
        </Pressable>
      </View>
    </Animated.View>
  )
}

type DrawerEntity = Pick<
  ElectricEntity,
  `url` | `type` | `status` | `tags` | `spawn_args`
>

type ManifestRecord = Record<string, unknown>

type DrawerEntry = {
  key: string
  groupKey: string
  groupLabel: string
  title: string
  meta: string
  action:
    | { kind: `entity`; url: string }
    | { kind: `state`; sourceId: string }
    | { kind: `inspect` }
  entity: DrawerEntity | null
  manifest: ManifestRecord | null
}

type DrawerGroup = {
  key: string
  label: string
  entries: Array<DrawerEntry>
}

function NativeEntityContextDrawer({
  entity,
  pendingMessages,
  manifests,
  editingKey,
  onEditPending,
  onDeletePending,
  onSteerPending,
  onReorderPending,
  onOpenEntity,
  onOpenStateSource,
  pendingActionsDisabled,
}: {
  entity: ElectricEntity
  pendingMessages: Array<PendingInboxMessage>
  manifests: Array<ManifestRecord>
  editingKey: string | null
  onEditPending: (message: PendingInboxMessage) => void
  onDeletePending: (key: string) => void
  onSteerPending: (key: string) => void
  onReorderPending: (key: string, position: string) => void
  onOpenEntity?: (entityUrl: string) => void
  onOpenStateSource?: (sourceId: string) => void
  pendingActionsDisabled: boolean
}): React.ReactElement | null {
  const { entitiesCollection } = useAgents()
  const tokens = useTokens()
  const styles = useMemo(() => createDrawerStyles(tokens), [tokens])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set([`queued`])
  )
  const [inspectedKey, setInspectedKey] = useState<string | null>(null)

  const referencedEntityUrls = useMemo(() => {
    const urls = new Set<string>()
    if (entity.parent) urls.add(entity.parent)
    for (const manifest of manifests) {
      if (
        manifest.kind === `child` &&
        typeof manifest.entity_url === `string`
      ) {
        urls.add(manifest.entity_url)
      } else if (
        manifest.kind === `source` &&
        manifest.sourceType === `entity` &&
        typeof manifest.sourceRef === `string`
      ) {
        urls.add(manifest.sourceRef)
      }
    }
    return Array.from(urls)
  }, [entity.parent, manifests])

  const { data: referencedEntities = [] } = useLiveQuery(
    (query) => {
      if (referencedEntityUrls.length === 0) return undefined
      return query
        .from({ e: entitiesCollection })
        .where(({ e }) => inArray(e.url, referencedEntityUrls))
        .select(({ e }) => ({
          url: e.url,
          type: e.type,
          status: e.status,
          tags: e.tags,
          spawn_args: e.spawn_args,
        }))
    },
    [entitiesCollection, referencedEntityUrls]
  )

  const entitiesByUrl = useMemo(
    () =>
      new Map(
        (referencedEntities as Array<DrawerEntity>).map((item) => [
          item.url,
          item,
        ])
      ),
    [referencedEntities]
  )
  const parent = entity.parent
    ? (entitiesByUrl.get(entity.parent) ?? null)
    : null
  const groups = useMemo(
    () => buildDrawerGroups(parent, manifests, entitiesByUrl),
    [entitiesByUrl, manifests, parent]
  )

  if (pendingMessages.length === 0 && groups.length === 0) return null

  const toggleGroup = (key: string): void => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectEntry = (entry: DrawerEntry): void => {
    if (entry.action.kind === `entity`) {
      onOpenEntity?.(entry.action.url)
    } else if (entry.action.kind === `state`) {
      onOpenStateSource?.(entry.action.sourceId)
    } else {
      setInspectedKey((current) => (current === entry.key ? null : entry.key))
    }
  }

  return (
    <View style={styles.drawer}>
      <ScrollView
        style={styles.drawerBody}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {pendingMessages.length > 0 && (
          <DrawerSectionHeader
            label={`${pendingMessages.length} Queued`}
            expanded={expandedGroups.has(`queued`)}
            onPress={() => toggleGroup(`queued`)}
            styles={styles}
            tokens={tokens}
          />
        )}
        {expandedGroups.has(`queued`) &&
          pendingMessages.map((message, index) => (
            <QueuedMessageRow
              key={message.key}
              message={message}
              messages={pendingMessages}
              index={index}
              editing={editingKey === message.key}
              onEdit={onEditPending}
              onDelete={onDeletePending}
              onSteer={onSteerPending}
              onReorder={onReorderPending}
              actionsDisabled={pendingActionsDisabled}
              styles={styles}
              tokens={tokens}
            />
          ))}

        {groups.map((group) => {
          const expanded = expandedGroups.has(group.key)
          return (
            <View key={group.key}>
              <DrawerSectionHeader
                label={`${group.entries.length} ${group.label}`}
                expanded={expanded}
                onPress={() => toggleGroup(group.key)}
                styles={styles}
                tokens={tokens}
              />
              {expanded &&
                group.entries.map((entry) => (
                  <ManifestDrawerRow
                    key={entry.key}
                    entry={entry}
                    inspected={inspectedKey === entry.key}
                    onPress={() => selectEntry(entry)}
                    styles={styles}
                    tokens={tokens}
                  />
                ))}
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

function DrawerSectionHeader({
  label,
  expanded,
  onPress,
  styles,
  tokens,
}: {
  label: string
  expanded: boolean
  onPress: () => void
  styles: ReturnType<typeof createDrawerStyles>
  tokens: Tokens
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      style={({ pressed }) => [
        styles.sectionHeader,
        pressed ? styles.pressed : null,
      ]}
    >
      <Icon
        name={expanded ? `chevron-down` : `chevron-right`}
        size={16}
        color={tokens.text3}
      />
      <Text style={styles.sectionTitle}>{label}</Text>
    </Pressable>
  )
}

function QueuedMessageRow({
  message,
  messages,
  index,
  editing,
  onEdit,
  onDelete,
  onSteer,
  onReorder,
  actionsDisabled,
  styles,
  tokens,
}: {
  message: PendingInboxMessage
  messages: Array<PendingInboxMessage>
  index: number
  editing: boolean
  onEdit: (message: PendingInboxMessage) => void
  onDelete: (key: string) => void
  onSteer: (key: string) => void
  onReorder: (key: string, position: string) => void
  actionsDisabled: boolean
  styles: ReturnType<typeof createDrawerStyles>
  tokens: Tokens
}): React.ReactElement {
  const move = (direction: -1 | 1): void => {
    const nextOrder = [...messages]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= nextOrder.length) return
    const [moved] = nextOrder.splice(index, 1)
    if (!moved) return
    nextOrder.splice(targetIndex, 0, moved)
    const movedIndex = nextOrder.findIndex((item) => item.key === message.key)
    const previous = movedIndex > 0 ? nextOrder[movedIndex - 1] : undefined
    const next =
      movedIndex >= 0 && movedIndex < nextOrder.length - 1
        ? nextOrder[movedIndex + 1]
        : undefined
    onReorder(
      message.key,
      createQueuePositionBetween(previous?.position, next?.position)
    )
  }

  return (
    <View style={[styles.rowShell, editing ? styles.rowEditing : null]}>
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {readTextPayload(message.payload) || `Untitled message`}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <SmallActionButton
          label="Move queued message up"
          disabled={actionsDisabled || index === 0}
          onPress={() => move(-1)}
          styles={styles}
        >
          <Icon name="chevron-up" size={14} color={tokens.text2} />
        </SmallActionButton>
        <SmallActionButton
          label="Move queued message down"
          disabled={actionsDisabled || index === messages.length - 1}
          onPress={() => move(1)}
          styles={styles}
        >
          <Icon name="chevron-down" size={14} color={tokens.text2} />
        </SmallActionButton>
        <SmallActionButton
          label="Edit queued message"
          disabled={actionsDisabled}
          onPress={() => onEdit(message)}
          styles={styles}
        >
          <Icon name="pencil" size={14} color={tokens.text2} />
        </SmallActionButton>
        <SmallActionButton
          label="Steer now"
          disabled={actionsDisabled}
          onPress={() => onSteer(message.key)}
          styles={styles}
        >
          <Icon name="arrow-up" size={14} color={tokens.text2} />
        </SmallActionButton>
        <SmallActionButton
          label="Delete queued message"
          disabled={actionsDisabled}
          onPress={() => onDelete(message.key)}
          styles={styles}
        >
          <Icon name="close" size={14} color={tokens.text2} />
        </SmallActionButton>
      </View>
    </View>
  )
}

function SmallActionButton({
  label,
  disabled = false,
  onPress,
  children,
  styles,
}: {
  label: string
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
  styles: ReturnType<typeof createDrawerStyles>
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.actionButton,
        disabled ? styles.disabledAction : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      {children}
    </Pressable>
  )
}

function ManifestDrawerRow({
  entry,
  inspected,
  onPress,
  styles,
}: {
  entry: DrawerEntry
  inspected: boolean
  onPress: () => void
  styles: ReturnType<typeof createDrawerStyles>
  tokens: Tokens
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.rowShell,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.statusSlot}>
        {entry.entity ? <StatusDot status={entry.entity.status} /> : null}
      </View>
      <View style={styles.rowMain}>
        <View style={styles.rowLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {entry.title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {entry.meta}
          </Text>
        </View>
        {inspected && entry.manifest ? (
          <ScrollView style={styles.inspectBox} nestedScrollEnabled>
            <Text style={styles.inspectText}>
              {JSON.stringify(entry.manifest, null, 2)}
            </Text>
          </ScrollView>
        ) : null}
      </View>
    </Pressable>
  )
}

function buildDrawerGroups(
  parent: DrawerEntity | null,
  manifests: Array<ManifestRecord>,
  entitiesByUrl: Map<string, DrawerEntity>
): Array<DrawerGroup> {
  const grouped = new Map<string, DrawerGroup>()
  if (parent) {
    grouped.set(`parent`, {
      key: `parent`,
      label: `Parent`,
      entries: [createParentEntry(parent)],
    })
  }

  for (const manifest of manifests) {
    const rawEntry = createManifestEntry(manifest, entitiesByUrl)
    if (!rawEntry) continue
    const entry =
      manifest.kind === `child`
        ? rawEntry
        : {
            ...rawEntry,
            groupKey: `manifest`,
            groupLabel: `Manifest items`,
            title: `${manifestKindLabel(manifest)} · ${rawEntry.title}`,
          }
    const group = grouped.get(entry.groupKey)
    if (group) group.entries.push(entry)
    else {
      grouped.set(entry.groupKey, {
        key: entry.groupKey,
        label: entry.groupLabel,
        entries: [entry],
      })
    }
  }

  const groups = Array.from(grouped.values()).filter(
    (group) => group.entries.length > 0
  )
  const manifestIndex = groups.findIndex((group) => group.key === `manifest`)
  if (manifestIndex >= 0) {
    const [manifestGroup] = groups.splice(manifestIndex, 1)
    groups.push(manifestGroup!)
  }
  return groups
}

function createParentEntry(parent: DrawerEntity): DrawerEntry {
  const title = getEntityDisplayTitle(parent as ElectricEntity)
  const id = parent.url.split(`/`).pop() ?? parent.url
  return {
    key: `parent:${parent.url}`,
    groupKey: `parent`,
    groupLabel: `Parent`,
    title,
    meta: `${parent.type} · ${id}`,
    manifest: null,
    action: { kind: `entity`, url: parent.url },
    entity: parent,
  }
}

function createManifestEntry(
  manifest: ManifestRecord,
  entitiesByUrl: Map<string, DrawerEntity>
): DrawerEntry | null {
  const key =
    typeof manifest.key === `string` ? manifest.key : JSON.stringify(manifest)

  switch (manifest.kind) {
    case `child`: {
      const url =
        typeof manifest.entity_url === `string` ? manifest.entity_url : null
      if (!url) return null
      return {
        key,
        groupKey: `child`,
        groupLabel: `Children`,
        title: stringValue(manifest.id, url.split(`/`).pop() ?? url),
        meta: `${stringValue(manifest.entity_type, `entity`)}${
          manifest.observed === false ? ` · unobserved` : ``
        }`,
        manifest,
        action: { kind: `entity`, url },
        entity: entitiesByUrl.get(url) ?? null,
      }
    }
    case `source`: {
      const sourceType = stringValue(manifest.sourceType, `source`)
      const sourceRef = stringValue(manifest.sourceRef, `source`)
      if (sourceType === `entity`) {
        return {
          key,
          groupKey: `source:entity`,
          groupLabel: `Entity Sources`,
          title: sourceRef.split(`/`).pop() ?? sourceRef,
          meta: sourceRef,
          manifest,
          action: { kind: `entity`, url: sourceRef },
          entity: entitiesByUrl.get(sourceRef) ?? null,
        }
      }
      if (sourceType === `db`) {
        return {
          key,
          groupKey: `source:db`,
          groupLabel: `Database Sources`,
          title: sourceRef,
          meta: describeSourceConfig(manifest.config),
          manifest,
          action: { kind: `state`, sourceId: sourceRef },
          entity: null,
        }
      }
      return {
        key,
        groupKey: `source:${sourceType}`,
        groupLabel: `${titleCase(sourceType)} Sources`,
        title: sourceRef,
        meta: describeSourceConfig(manifest.config),
        manifest,
        action: { kind: `inspect` },
        entity: null,
      }
    }
    case `shared-state`:
      return {
        key,
        groupKey: `shared-state`,
        groupLabel: `Shared State`,
        title: stringValue(manifest.id, `shared state`),
        meta: `${stringValue(manifest.mode, `state`)} · ${Object.keys(
          isRecord(manifest.collections) ? manifest.collections : {}
        ).join(`, `)}`,
        manifest,
        action: { kind: `state`, sourceId: stringValue(manifest.id, ``) },
        entity: null,
      }
    case `effect`:
      return {
        key,
        groupKey: `effect`,
        groupLabel: `Effects`,
        title: stringValue(manifest.id, `effect`),
        meta: stringValue(manifest.function_ref, `function`),
        manifest,
        action: { kind: `inspect` },
        entity: null,
      }
    case `context`:
      return {
        key,
        groupKey: `context`,
        groupLabel: `Context`,
        title: stringValue(manifest.name, `context`),
        meta: stringValue(manifest.id, `context`),
        manifest,
        action: { kind: `inspect` },
        entity: null,
      }
    case `schedule`:
      return {
        key,
        groupKey: `schedule:${stringValue(manifest.scheduleType, `timer`)}`,
        groupLabel:
          manifest.scheduleType === `cron` ? `Cron Schedules` : `Future Sends`,
        title: stringValue(manifest.id, `schedule`),
        meta: describeSchedule(manifest),
        manifest,
        action: { kind: `inspect` },
        entity: null,
      }
    default:
      return null
  }
}

function manifestKindLabel(manifest: ManifestRecord): string {
  switch (manifest.kind) {
    case `source`:
      return `${titleCase(stringValue(manifest.sourceType, `Source`))} source`
    case `shared-state`:
      return `Shared state`
    case `effect`:
      return `Effect`
    case `context`:
      return `Context`
    case `schedule`:
      return manifest.scheduleType === `cron` ? `Cron schedule` : `Future send`
    default:
      return `Manifest`
  }
}

function describeSourceConfig(config: unknown): string {
  if (!isRecord(config)) return `source`
  const collections = isRecord(config.collections)
    ? Object.keys(config.collections)
    : []
  return collections.length > 0 ? collections.join(`, `) : `source`
}

function describeSchedule(manifest: ManifestRecord): string {
  if (manifest.scheduleType === `cron`) {
    const expression = stringValue(manifest.expression, `cron`)
    const timezone =
      typeof manifest.timezone === `string` ? ` · ${manifest.timezone}` : ``
    return `${expression}${timezone}`
  }
  const fireAt = stringValue(manifest.fireAt, `future`)
  const status =
    typeof manifest.status === `string` ? ` · ${manifest.status}` : ``
  return `${fireAt}${status}`
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === `string` && value.length > 0 ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(` `)
}

function useKeyboardAttachment(): {
  keyboardVisible: boolean
  keyboardTranslateY: Animated.Value
} {
  const keyboardTranslateY = useRef(new Animated.Value(0)).current
  const [keyboardVisible, setKeyboardVisible] = useState(false)

  useEffect(() => {
    const animateTo = (event: KeyboardEvent, toValue: number): void => {
      Animated.timing(keyboardTranslateY, {
        toValue,
        duration: event.duration ?? 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start()
    }

    const showOrChange = (event: KeyboardEvent): void => {
      setKeyboardVisible(true)
      animateTo(event, -event.endCoordinates.height)
    }
    const hide = (event: KeyboardEvent): void => {
      setKeyboardVisible(false)
      animateTo(event, 0)
    }

    const subscriptions = [
      Keyboard.addListener(`keyboardWillChangeFrame`, showOrChange),
      Keyboard.addListener(`keyboardWillHide`, hide),
      Keyboard.addListener(`keyboardDidShow`, showOrChange),
      Keyboard.addListener(`keyboardDidHide`, hide),
    ]

    return () => {
      for (const subscription of subscriptions) subscription.remove()
    }
  }, [keyboardTranslateY])

  return { keyboardVisible, keyboardTranslateY }
}

function createStyles(_tokens: Tokens) {
  return StyleSheet.create({
    body: {
      flex: 1,
    },
    screen: {
      backgroundColor: `transparent`,
    },
    bodyFill: {
      flex: 1,
      backgroundColor: `transparent`,
    },
  })
}

function createComposerStyles(tokens: Tokens) {
  return StyleSheet.create({
    root: {
      position: `absolute`,
      left: 0,
      right: 0,
      bottom: 0,
      marginTop: -CHAT_COMPOSER_OVERLAP,
      paddingHorizontal: spacing.lg,
      paddingTop: 0,
      zIndex: 10,
    },
    composer: {
      minHeight: 48,
      flexDirection: `row`,
      alignItems: `flex-end`,
      gap: spacing.sm,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: tokens.border1,
      borderRadius: radii.xl,
      backgroundColor: tokens.surfaceRaised,
      shadowColor: `#000`,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: tokens.scheme === `dark` ? 0.35 : 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
    disabled: {
      opacity: 0.65,
    },
    input: {
      flex: 1,
      minWidth: 0,
      maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
      minHeight: COMPOSER_INPUT_MIN_HEIGHT,
      // (34 - 24 line height) / 2 vertically centers a single line within the
      // button-height min, while leaving breathing room as it grows multiline.
      paddingVertical: 5,
      fontSize: fontSize.lg,
      lineHeight: lineHeight.lg,
      textAlignVertical: `top`,
    },
    // Base text colour lives on the rendered child spans, not the input, so the
    // command spans can override it (a nested colour is ignored when the
    // TextInput sets its own `color`).
    baseText: {
      color: tokens.text1,
    },
    commandToken: {
      color: tokens.accent11,
      backgroundColor: tokens.accentA2,
      fontWeight: `600`,
    },
    // Arguments share the command's subtle background but regular weight (vs the
    // command's bold), so the value reads as the "slot" within the badge.
    argToken: {
      color: tokens.accent11,
      backgroundColor: tokens.accentA2,
    },
    sendButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: `center`,
      justifyContent: `center`,
      backgroundColor: tokens.accentA3,
    },
    sendButtonActive: {
      backgroundColor: tokens.accent9,
    },
    stopButton: {
      width: 24,
      height: 24,
      borderRadius: 12,
      margin: 5,
      backgroundColor: tokens.accent9,
    },
    stopButtonPending: {
      opacity: 0.72,
    },
    sendButtonPressed: {
      opacity: 0.8,
    },
    error: {
      marginBottom: spacing.xs,
      color: tokens.red11,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
    editingBanner: {
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.lg,
      backgroundColor: tokens.accentA2,
      flexDirection: `row`,
      alignItems: `center`,
      justifyContent: `space-between`,
      gap: spacing.sm,
    },
    editingText: {
      color: tokens.text2,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
    editingCancel: {
      color: tokens.accent11,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
      fontWeight: `600`,
    },
    replyBanner: {
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radii.lg,
      backgroundColor: tokens.accentA2,
      flexDirection: `row`,
      alignItems: `center`,
      justifyContent: `space-between`,
      gap: spacing.sm,
    },
    replyBannerBody: {
      flex: 1,
    },
    replyLabel: {
      color: tokens.text2,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
      fontWeight: `600`,
    },
    replyText: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
    modeToggle: {
      flexDirection: `row`,
      alignSelf: `flex-end`,
      marginBottom: spacing.xs,
      padding: 2,
      borderRadius: radii.pill,
      backgroundColor: tokens.surface,
      borderWidth: 1,
      borderColor: tokens.border1,
      gap: 2,
    },
    modeButton: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radii.pill,
    },
    modeButtonActive: {
      backgroundColor: tokens.accentA3,
    },
    modeButtonText: {
      color: tokens.text3,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
      fontWeight: `600`,
    },
    modeButtonTextActive: {
      color: tokens.accent11,
    },
  })
}

function createDrawerStyles(tokens: Tokens) {
  return StyleSheet.create({
    drawer: {
      marginHorizontal: spacing.xs,
      marginBottom: -spacing.sm,
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.md,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: tokens.border1,
      backgroundColor: tokens.surface,
      maxHeight: 260,
      overflow: `hidden`,
    },
    drawerBody: {
      flexGrow: 0,
    },
    sectionHeader: {
      minHeight: 34,
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
      borderRadius: radii.md,
    },
    sectionTitle: {
      color: tokens.text2,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
      fontWeight: `600`,
    },
    rowShell: {
      minHeight: 38,
      flexDirection: `row`,
      alignItems: `center`,
      gap: spacing.sm,
      paddingLeft: spacing.md,
      paddingRight: spacing.xs,
      paddingVertical: spacing.xs,
      borderRadius: radii.md,
    },
    rowEditing: {
      backgroundColor: tokens.accentA2,
    },
    rowMain: {
      flex: 1,
      minWidth: 0,
    },
    rowLine: {
      flexDirection: `row`,
      alignItems: `baseline`,
      gap: spacing.sm,
      minWidth: 0,
    },
    rowTitle: {
      flex: 1,
      minWidth: 0,
      color: tokens.text1,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    rowMeta: {
      flexShrink: 0,
      maxWidth: `45%`,
      color: tokens.text3,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
    rowActions: {
      flexDirection: `row`,
      alignItems: `center`,
      gap: 2,
    },
    actionButton: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: `center`,
      justifyContent: `center`,
    },
    disabledAction: {
      opacity: 0.25,
    },
    pressed: {
      backgroundColor: tokens.bgHover,
    },
    statusSlot: {
      width: 16,
      alignItems: `center`,
    },
    inspectBox: {
      marginTop: spacing.xs,
      maxHeight: 110,
      borderRadius: radii.md,
      backgroundColor: tokens.surfaceRaised,
      padding: spacing.sm,
    },
    inspectText: {
      color: tokens.text2,
      fontSize: fontSize.xs,
      lineHeight: lineHeight.xs,
    },
  })
}
