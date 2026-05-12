import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
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
  createSendMessageAction,
  createSteerInboxMessageAction,
  createUpdateInboxMessageAction,
  readTextPayload,
} from '@electric-ax/agents-server-ui/src/lib/sendMessage'
import type { OptimisticInboxMessage } from '@electric-ax/agents-server-ui/src/lib/sendMessage'
import { Header, HeaderBackButton } from '../components/Header'
import { Icon } from '../components/Icon'
import { Screen } from '../components/Screen'
import { SessionMenu } from '../components/SessionMenu'
import { StatusDot } from '../components/StatusDot'
import { TopBarIconButton } from '../components/TopBarIconButton'
import { useAgents } from '../lib/AgentsProvider'
import { getEntityDisplayTitle } from '../lib/agentsClient'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, lineHeight, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'
import type { EmbedViewId } from '../lib/embedView'
import type { ElectricEntity } from '../lib/agentsClient'

export const CHAT_COMPOSER_BASE_HEIGHT = 76
export const CHAT_COMPOSER_OVERLAP = 20

const COMPOSER_INPUT_MIN_HEIGHT = 40
const COMPOSER_INPUT_MAX_HEIGHT = 200
const COMPOSER_MIN_CARD_HEIGHT = 48
const INLINE_QUEUED_TIMEOUT_MS = 15_000

type EntityStreamState = ReturnType<typeof useEntityTimeline>
type EntityStreamDB = EntityStreamState[`db`]
type PendingInboxMessage = EntityStreamState[`pendingInbox`][number]
type TimelineEntry = EntityStreamState[`entries`][number]

export function ChatSessionScreen({
  entityUrl,
  onBack,
  onSetView,
  onOpenEntity,
  onOpenStateSource,
  onComposerHeightChange,
  onSendMessage,
  onInlineQueuedMessagesChange,
}: {
  entityUrl: string
  onBack: () => void
  onSetView: (view: EmbedViewId) => void
  onOpenEntity: (entityUrl: string) => void
  onOpenStateSource: (sourceId: string) => void
  onComposerHeightChange: (height: number) => void
  onSendMessage: () => void
  onInlineQueuedMessagesChange?: (
    messages: Array<OptimisticInboxMessage>
  ) => void
}): React.ReactElement {
  return (
    <SessionScreen
      entityUrl={entityUrl}
      view="chat"
      onBack={onBack}
      onSetView={onSetView}
      onOpenEntity={onOpenEntity}
      onOpenStateSource={onOpenStateSource}
      onComposerHeightChange={onComposerHeightChange}
      onSendMessage={onSendMessage}
      onInlineQueuedMessagesChange={onInlineQueuedMessagesChange}
    />
  )
}

export function StateInspectorSessionScreen({
  entityUrl,
  onBack,
  onSetView,
}: {
  entityUrl: string
  onBack: () => void
  onSetView: (view: EmbedViewId) => void
}): React.ReactElement {
  return (
    <SessionScreen
      entityUrl={entityUrl}
      view="state-explorer"
      onBack={onBack}
      onSetView={onSetView}
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
}): React.ReactElement {
  const { entitiesCollection, serverUrl } = useAgents()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])
  const [menuOpen, setMenuOpen] = useState(false)
  const [inlineQueuedMessages, setInlineQueuedMessages] = useState<
    Map<string, OptimisticInboxMessage>
  >(() => new Map())
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
  const streamEntityUrl =
    view === `chat` && entity?.status !== `spawning` ? entityUrl : null
  const { entries, pendingInbox, db } = useEntityTimeline(
    serverUrl,
    streamEntityUrl
  )
  const manifests = useMemo(
    () =>
      entries
        .filter(isManifestEntry)
        .map((entry) => entry.section.manifest as ManifestRecord),
    [entries]
  )
  const processedInboxKeySignature = useMemo(
    () =>
      entries
        .filter((entry) => entry.section.kind === `user_message`)
        .map((entry) => entry.key.replace(/^inbox:/, ``))
        .join(`\0`),
    [entries]
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
      {view === `chat` && (
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
          disabled={
            !db || entity?.status === `stopped` || entity?.status === `spawning`
          }
          placeholder={
            entity?.status === `stopped`
              ? `Entity stopped`
              : entity?.status === `spawning`
                ? `Starting...`
                : !db
                  ? `Connecting...`
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
      />
    </Screen>
  )
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
  disabled: boolean
  placeholder: string
}): React.ReactElement {
  const { serverUrl } = useAgents()
  const tokens = useTokens()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => createComposerStyles(tokens), [tokens])
  const { keyboardVisible, keyboardTranslateY } = useKeyboardAttachment()
  const [value, setValue] = useState(``)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<{
    key: string
  } | null>(null)
  const [inputHeight, setInputHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT)
  const text = value.trim()
  const bottomPadding = keyboardVisible ? 4 : Math.max(insets.bottom, 8)
  const sendAction = useMemo(() => {
    if (!db) return null
    return createSendMessageAction({
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
  const canSend = text.length > 0 && !disabled && !sending
  const setMeasuredInputHeight = (height: number): void => {
    const nextHeight = Math.min(
      COMPOSER_INPUT_MAX_HEIGHT,
      Math.max(COMPOSER_INPUT_MIN_HEIGHT, Math.ceil(height))
    )
    setInputHeight((current) => (current === nextHeight ? current : nextHeight))
  }

  const handleChangeText = (nextValue: string): void => {
    setValue(nextValue)

    // `onContentSizeChange` is the source of truth for wrapped lines, but
    // explicit newlines can be reflected immediately while RN catches up.
    const explicitLines = nextValue.split(/\r\n|\r|\n/).length
    if (explicitLines > 1) {
      setMeasuredInputHeight(explicitLines * lineHeight.lg + spacing.lg)
    }
  }

  useEffect(() => {
    const cardHeight = Math.max(
      COMPOSER_MIN_CARD_HEIGHT,
      inputHeight + spacing.sm * 2
    )
    const errorHeight = error ? lineHeight.xs + spacing.xs : 0
    onHeightChange?.(cardHeight + bottomPadding + errorHeight)
  }, [bottomPadding, error, inputHeight, onHeightChange])

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
      setEditingMessage(null)
      onSendMessage?.()
      finishPersistedAction(tx.isPersisted.promise)
      return
    }

    const tx = sendAction?.({ text, mode: `queued` })
    if (!tx) {
      setSending(false)
      return
    }

    setValue(``)
    setEditingMessage(null)
    onSendMessage?.()
    finishPersistedAction(tx.isPersisted.promise)
  }

  const startEditing = useCallback(
    (message: PendingInboxMessage): void => {
      const queuedText = readTextPayload(message.payload)
      setError(null)
      updateAction?.({
        key: message.key,
        mode: `paused`,
        status: `pending`,
      }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      setEditingMessage({ key: message.key })
      setValue(queuedText)
    },
    [updateAction]
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
  }, [editingMessage, updateAction])

  const deleteMessage = useCallback(
    (key: string): void => {
      setError(null)
      deleteAction?.({ key }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      if (editingMessage?.key === key) cancelEditing()
    },
    [cancelEditing, deleteAction, editingMessage?.key]
  )

  const steerMessage = useCallback(
    (key: string): void => {
      setError(null)
      steerAction?.({ key }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      if (editingMessage?.key === key) cancelEditing()
      onSendMessage?.()
    },
    [cancelEditing, editingMessage?.key, onSendMessage, steerAction]
  )

  const reorderMessage = useCallback(
    (key: string, position: string): void => {
      setError(null)
      updateAction?.({ key, position }).isPersisted.promise.catch(
        (err: Error) => {
          setError(err.message)
        }
      )
    },
    [updateAction]
  )

  return (
    <Animated.View
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      style={[
        styles.root,
        {
          paddingBottom: bottomPadding,
          transform: [{ translateY: keyboardTranslateY }],
        },
      ]}
    >
      {error && <Text style={styles.error}>{error}</Text>}
      {entity && (
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
      <View style={[styles.composer, disabled ? styles.disabled : null]}>
        <TextInput
          value={value}
          onChangeText={handleChangeText}
          editable={!disabled && !sending}
          multiline
          placeholder={placeholder}
          placeholderTextColor={tokens.text4}
          scrollEnabled={inputHeight >= COMPOSER_INPUT_MAX_HEIGHT}
          onContentSizeChange={(event) => {
            setMeasuredInputHeight(event.nativeEvent.contentSize.height)
          }}
          style={[styles.input, { height: inputHeight }]}
          returnKeyType="default"
        />
        <Pressable
          onPress={send}
          disabled={!canSend}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={({ pressed }) => [
            styles.sendButton,
            canSend ? styles.sendButtonActive : null,
            pressed && canSend ? styles.sendButtonPressed : null,
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={tokens.textOnAccent} />
          ) : (
            <Icon
              name="arrow-up"
              size={18}
              color={canSend ? tokens.textOnAccent : tokens.text4}
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

function isManifestEntry(
  entry: TimelineEntry
): entry is TimelineEntry & {
  section: { kind: `manifest`; manifest: unknown }
} {
  return entry.section.kind === `manifest`
}

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
          disabled={index === 0}
          onPress={() => move(-1)}
          styles={styles}
        >
          <Icon name="chevron-up" size={14} color={tokens.text2} />
        </SmallActionButton>
        <SmallActionButton
          label="Move queued message down"
          disabled={index === messages.length - 1}
          onPress={() => move(1)}
          styles={styles}
        >
          <Icon name="chevron-down" size={14} color={tokens.text2} />
        </SmallActionButton>
        <SmallActionButton
          label="Edit queued message"
          onPress={() => onEdit(message)}
          styles={styles}
        >
          <Icon name="pencil" size={14} color={tokens.text2} />
        </SmallActionButton>
        <SmallActionButton
          label="Steer now"
          onPress={() => onSteer(message.key)}
          styles={styles}
        >
          <Icon name="arrow-up" size={14} color={tokens.text2} />
        </SmallActionButton>
        <SmallActionButton
          label="Delete queued message"
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
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {entry.meta}
        </Text>
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
      backgroundColor: tokens.bg,
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
      paddingVertical: 0,
      color: tokens.text1,
      fontSize: fontSize.lg,
      lineHeight: lineHeight.lg,
      textAlignVertical: `top`,
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
    rowTitle: {
      color: tokens.text1,
      fontSize: fontSize.sm,
      lineHeight: lineHeight.sm,
    },
    rowMeta: {
      marginTop: 1,
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
