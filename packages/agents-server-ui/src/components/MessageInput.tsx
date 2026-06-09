import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Mic, MicOff, Square } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import {
  createDeleteInboxMessageAction,
  createSendComposerInputAction,
  createSteerInboxMessageAction,
  createUpdateInboxMessageAction,
  readTextPayload,
} from '../lib/sendMessage'
import {
  createSendCommentAction,
  type SelectedCommentTarget,
} from '../lib/comments'
import {
  isGoalCommandText,
  parseGoalCommand,
  serializeComposerInput,
} from '@electric-ax/agents-runtime/client'
import {
  startRealtimeAudioSession,
  type RealtimeAudioSession,
} from '../lib/realtime-audio'
import { ComposerEditor } from './ComposerEditor'
import { ComposerShell } from './ComposerShell'
import { Icon, Stack, Text, Tooltip } from '../ui'
import {
  AttachmentActionMenu,
  AttachmentPreviewTray,
  imageAttachmentDraftPolicy,
  useAttachmentDrafts,
} from './AttachmentDrafts'
import styles from './MessageInput.module.css'
import type { EntityTimelineData } from '@electric-ax/agents-runtime/client'
import type {
  ComposerInputPayload,
  SlashCommandRow,
} from '@electric-ax/agents-runtime/client'
import type { OptimisticInboxMessage } from '../lib/sendMessage'

// /goal commands that mutate state should interrupt any in-flight agent
// run so the user doesn't have to wait for the old work to finish before
// the new goal/state takes effect. /goal show is read-only and never
// aborts. Delegates to the runtime's parser so the recognized grammar
// (including subcommand aliases) can't drift from the dispatcher.
function isAbortingGoalCommand(text: string): boolean {
  if (!isGoalCommandText(text)) return false
  const kind = parseGoalCommand(text).kind
  return kind === `set` || kind === `clear` || kind === `complete`
}

type ComposerMode = `prompt` | `comment`

export function MessageInput({
  db,
  baseUrl,
  entityUrl,
  disabled,
  fallbackSlashCommands = [],
  writeDisabled = false,
  stopDisabled = false,
  disabledPlaceholder,
  generationActive = false,
  stopPending = false,
  imageAttachmentsEnabled = true,
  pendingMessages = [],
  inlineQueuedSubmits = false,
  onOptimisticQueuedMessage,
  defaultMode = `prompt`,
  commentOnly = false,
  commentTarget = null,
  onClearCommentTarget,
  drawer,
  onSend,
  onStop,
  autoStartRealtimeSignal,
  onRealtimeAutoStartConsumed,
}: {
  db: EntityStreamDBWithActions | null
  baseUrl: string
  entityUrl: string
  disabled: boolean
  fallbackSlashCommands?: Array<SlashCommandRow>
  writeDisabled?: boolean
  stopDisabled?: boolean
  disabledPlaceholder?: string
  generationActive?: boolean
  stopPending?: boolean
  imageAttachmentsEnabled?: boolean
  pendingMessages?: EntityTimelineData[`inbox`]
  inlineQueuedSubmits?: boolean
  onOptimisticQueuedMessage?: (message: OptimisticInboxMessage) => void
  defaultMode?: ComposerMode
  commentOnly?: boolean
  commentTarget?: SelectedCommentTarget | null
  onClearCommentTarget?: () => void
  onSend?: () => void
  onStop?: () => void
  autoStartRealtimeSignal?: string | null
  onRealtimeAutoStartConsumed?: () => void
  /**
   * Optional content rendered above the composer, sharing its docked
   * width and lift into the timeline above. The composer is z-indexed
   * over whatever the drawer renders so the drawer can extend its
   * bottom edge underneath the composer for a "tray" effect (see
   * `EntityContextDrawer`).
   */
  drawer?: (props: {
    pendingMessages: EntityTimelineData[`inbox`]
    editingKey: string | null
    onEdit: (message: EntityTimelineData[`inbox`][number]) => void
    onDelete: (key: string) => void
    onSteer: (key: string) => void
    onReorder: (key: string, position: string) => void
    disabled: boolean
  }) => React.ReactNode
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [error, setError] = useState<string | null>(null)
  const [composerMode, setComposerMode] = useState<ComposerMode>(
    commentOnly ? `comment` : defaultMode
  )
  const [editingMessage, setEditingMessage] = useState<{
    key: string
    originalText: string
  } | null>(null)
  const [realtimePending, setRealtimePending] = useState(false)
  const [realtimeActive, setRealtimeActive] = useState(false)
  const [realtimeInputLevel, setRealtimeInputLevel] = useState(0)
  const realtimeSessionRef = useRef<RealtimeAudioSession | null>(null)
  const handledAutoStartRealtimeRef = useRef<string | null>(null)
  const composerFocusRef = useRef<{ focus: () => void } | null>(null)
  const inputDisabled = disabled || writeDisabled
  const isCommentMode = composerMode === `comment`
  const attachmentsDisabled =
    inputDisabled ||
    Boolean(editingMessage) ||
    isCommentMode ||
    !imageAttachmentsEnabled
  const {
    attachments,
    clearAttachments,
    dropActive,
    dropZoneProps,
    fileInputRef,
    addAttachments,
    openAttachmentPicker,
    handlePaste,
    removeAttachment,
  } = useAttachmentDrafts({
    policy: imageAttachmentDraftPolicy,
    disabled: attachmentsDisabled,
    focusRef: composerFocusRef,
  })

  useEffect(() => {
    if (!imageAttachmentsEnabled) clearAttachments()
  }, [imageAttachmentsEnabled, clearAttachments])

  useEffect(() => {
    setComposerMode(commentOnly ? `comment` : defaultMode)
  }, [commentOnly, defaultMode, entityUrl])

  useEffect(() => {
    if (commentTarget) setComposerMode(`comment`)
  }, [commentTarget])

  useEffect(() => {
    if (isCommentMode) clearAttachments()
  }, [isCommentMode, clearAttachments])

  const { data: slashCommands = [] } = useLiveQuery(
    (q) =>
      db
        ? q
            .from({ slashCommand: db.collections.slashCommands as any })
            .orderBy(({ slashCommand }: any) => slashCommand.name, `asc`)
        : undefined,
    [db]
  )
  const effectiveSlashCommands = isCommentMode
    ? []
    : slashCommands.length > 0
      ? (slashCommands as Array<SlashCommandRow>)
      : fallbackSlashCommands

  const sendComposerAction = useMemo(() => {
    if (!db) return null
    return createSendComposerInputAction({
      db,
      baseUrl,
      entityUrl,
      onOptimisticMessage: (message) => {
        if (inlineQueuedSubmits && message.mode === `queued`) {
          onOptimisticQueuedMessage?.(message)
        }
      },
    })
  }, [db, baseUrl, entityUrl, inlineQueuedSubmits, onOptimisticQueuedMessage])
  const commentsAvailable = Boolean(
    db && (db.collections as Record<string, unknown>).comments
  )
  const sendCommentAction = useMemo(() => {
    if (!db || !commentsAvailable) return null
    return createSendCommentAction({ db, baseUrl, entityUrl })
  }, [db, commentsAvailable, baseUrl, entityUrl])
  const updateAction = useMemo(() => {
    if (!db) return null
    return createUpdateInboxMessageAction({ db, baseUrl, entityUrl })
  }, [db, baseUrl, entityUrl])
  const deleteAction = useMemo(() => {
    if (!db) return null
    return createDeleteInboxMessageAction({ db, baseUrl, entityUrl })
  }, [db, baseUrl, entityUrl])
  const steerAction = useMemo(() => {
    if (!db) return null
    return createSteerInboxMessageAction({ db, baseUrl, entityUrl })
  }, [db, baseUrl, entityUrl])

  const inputText = value.trim()
  const attachmentCount =
    !isCommentMode && imageAttachmentsEnabled ? attachments.length : 0
  const canSubmit =
    !inputDisabled &&
    (isCommentMode
      ? inputText.length > 0
      : editingMessage
        ? inputText.length > 0
        : inputText.length > 0 || attachmentCount > 0)
  const canAttachFiles =
    !inputDisabled &&
    !editingMessage &&
    !isCommentMode &&
    imageAttachmentsEnabled
  const showStop =
    !isCommentMode &&
    generationActive &&
    !realtimeActive &&
    inputText.length === 0 &&
    attachmentCount === 0 &&
    !disabled
  const canStop = showStop && !stopPending && !stopDisabled
  const canUseRealtime =
    !inputDisabled && !editingMessage && !isCommentMode && Boolean(baseUrl)

  useEffect(() => {
    return () => {
      void realtimeSessionRef.current?.stop()
      realtimeSessionRef.current = null
    }
  }, [])

  const handleSubmit = useCallback(
    (composerPayload?: ComposerInputPayload) => {
      if (!canSubmit) return
      setError(null)
      const text = value.trim()
      if (isCommentMode) {
        const tx = sendCommentAction?.({
          body: text,
          ...(commentTarget
            ? {
                replyTo: commentTarget.target,
                targetSnapshot: commentTarget.snapshot,
              }
            : {}),
        })
        if (!tx) return
        onSend?.()
        setValue(``)
        onClearCommentTarget?.()
        tx.isPersisted.promise.catch((err: Error) => {
          setError(err.message)
          setValue((current) => (current ? current : text))
        })
        return
      }
      const files = imageAttachmentsEnabled ? attachments : []
      if (realtimeSessionRef.current && !editingMessage && files.length === 0) {
        const session = realtimeSessionRef.current
        setValue(``)
        onSend?.()
        session.sendText(text).catch((err: Error) => {
          setError(err.message)
          setValue((current) => (current ? current : text))
        })
        return
      }
      const tx = editingMessage
        ? updateAction?.({
            key: editingMessage.key,
            text,
            mode: `queued`,
            status: `pending`,
          })
        : sendComposerAction?.({
            payload:
              composerPayload ??
              serializeComposerInput(text, effectiveSlashCommands),
            mode: `queued`,
            ...(files.length > 0 ? { attachments: files } : {}),
          })
      if (!tx) return
      // State-changing /goal commands should interrupt any in-flight agent
      // run — otherwise the agent keeps working on the old goal/work even
      // though the user just told it to stop or pivot. /goal show is purely
      // a read, so it never aborts. `onStop` itself no-ops when nothing is
      // running, so this is safe to call unconditionally for the matching
      // commands.
      if (!editingMessage && isAbortingGoalCommand(text)) {
        onStop?.()
      }
      if (!editingMessage) onSend?.()
      setValue(``)
      clearAttachments()
      setEditingMessage(null)
      tx.isPersisted.promise.catch((err: Error) => {
        setError(err.message)
        if (!editingMessage) {
          setValue((current) => (current ? current : text))
          addAttachments(files)
        }
      })
    },
    [
      addAttachments,
      attachments,
      imageAttachmentsEnabled,
      canSubmit,
      clearAttachments,
      value,
      sendComposerAction,
      updateAction,
      editingMessage,
      onSend,
      onStop,
      isCommentMode,
      sendCommentAction,
      commentTarget,
      onClearCommentTarget,
      effectiveSlashCommands,
    ]
  )

  const handleComposerAction = useCallback(() => {
    if (canStop) {
      onStop?.()
      return
    }
    handleSubmit()
  }, [canStop, handleSubmit, onStop])

  const handleRealtimeToggle = useCallback(() => {
    if (realtimePending) return
    setError(null)
    if (realtimeSessionRef.current) {
      const session = realtimeSessionRef.current
      realtimeSessionRef.current = null
      setRealtimePending(true)
      session
        .stop()
        .catch((err: Error) => setError(err.message))
        .finally(() => {
          setRealtimeActive(false)
          setRealtimeInputLevel(0)
          setRealtimePending(false)
        })
      return
    }
    if (!canUseRealtime) return
    setRealtimePending(true)
    startRealtimeAudioSession({
      baseUrl,
      entityUrl,
      onInputLevel: setRealtimeInputLevel,
    })
      .then((session) => {
        realtimeSessionRef.current = session
        setRealtimeActive(true)
      })
      .catch((err: Error) => {
        setError(err.message)
        setRealtimeInputLevel(0)
      })
      .finally(() => {
        setRealtimePending(false)
      })
  }, [baseUrl, canUseRealtime, entityUrl, realtimePending])

  useEffect(() => {
    if (!autoStartRealtimeSignal) return
    if (handledAutoStartRealtimeRef.current === autoStartRealtimeSignal) return
    if (!canUseRealtime || realtimePending) return
    handledAutoStartRealtimeRef.current = autoStartRealtimeSignal
    onRealtimeAutoStartConsumed?.()
    if (!realtimeSessionRef.current) {
      handleRealtimeToggle()
    }
  }, [
    autoStartRealtimeSignal,
    canUseRealtime,
    handleRealtimeToggle,
    onRealtimeAutoStartConsumed,
    realtimePending,
  ])

  const startEditing = useCallback(
    (message: EntityTimelineData[`inbox`][number]) => {
      if (inputDisabled) return
      const text = readTextPayload(message.payload)
      setError(null)
      if (!commentOnly) setComposerMode(`prompt`)
      clearAttachments()
      updateAction?.({
        key: message.key,
        mode: `paused`,
        status: `pending`,
      }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      setEditingMessage({ key: message.key, originalText: text })
      setValue(text)
    },
    [clearAttachments, commentOnly, inputDisabled, updateAction]
  )

  const cancelEditing = useCallback(() => {
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
    clearAttachments()
  }, [clearAttachments, editingMessage, updateAction])

  const deleteMessage = useCallback(
    (key: string) => {
      if (inputDisabled) return
      if (!deleteAction) return
      setError(null)
      deleteAction({ key }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      if (editingMessage?.key === key) cancelEditing()
    },
    [deleteAction, inputDisabled, editingMessage?.key, cancelEditing]
  )

  const steerMessage = useCallback(
    (key: string) => {
      if (inputDisabled) return
      if (!steerAction) return
      setError(null)
      steerAction({ key }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      if (editingMessage?.key === key) cancelEditing()
    },
    [steerAction, inputDisabled, editingMessage?.key, cancelEditing]
  )
  const reorderMessage = useCallback(
    (key: string, position: string) => {
      if (inputDisabled) return
      if (!updateAction) return
      setError(null)
      updateAction({ key, position }).isPersisted.promise.catch(
        (err: Error) => {
          setError(err.message)
        }
      )
    },
    [inputDisabled, updateAction]
  )

  const isButtonActive = canSubmit || (showStop && !stopDisabled)
  const voiceLevel = realtimeActive ? realtimeInputLevel : 0
  const voiceBars = [
    Math.max(0.18, Math.min(1, 0.24 + voiceLevel * 0.76)),
    Math.max(0.24, Math.min(1, 0.34 + voiceLevel * 0.9)),
    Math.max(0.16, Math.min(1, 0.2 + voiceLevel * 0.82)),
  ]
  const sendTooltip = showStop
    ? stopDisabled
      ? `Signal permission required`
      : `Stop generating`
    : isCommentMode
      ? `Post comment`
      : `Send message`
  const replyPreviewLabel = formatReplyBannerLabel(commentTarget)
  const replyPreviewText = commentTarget?.snapshot.text
  return (
    <Stack direction="column" gap={0} className={styles.root}>
      {drawer?.({
        pendingMessages,
        editingKey: editingMessage?.key ?? null,
        onEdit: startEditing,
        onDelete: deleteMessage,
        onSteer: steerMessage,
        onReorder: reorderMessage,
        disabled: inputDisabled,
      })}
      {error && (
        <Text size={1} tone="danger" className={styles.errorText}>
          {error}
        </Text>
      )}
      <ComposerShell
        className={styles.chatComposerShell}
        disabled={inputDisabled}
        dropActive={dropActive}
        onPaste={handlePaste}
        dropZoneProps={dropZoneProps}
        banner={
          editingMessage ? (
            <div className={styles.editingBanner}>
              <Text size={1} tone="muted">
                Editing queued message
              </Text>
              <button
                type="button"
                aria-label="Cancel editing queued message"
                onClick={cancelEditing}
                className={styles.editingCancel}
              >
                Cancel
              </button>
            </div>
          ) : isCommentMode && commentTarget ? (
            <div className={styles.replyBanner}>
              <div className={styles.replyBannerText}>
                <Text size={1} tone="muted">
                  {replyPreviewLabel}
                </Text>
                {replyPreviewText && (
                  <span className={styles.replyBannerPreview}>
                    {replyPreviewText}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label="Clear comment target"
                onClick={onClearCommentTarget}
                className={styles.editingCancel}
              >
                Clear
              </button>
            </div>
          ) : null
        }
        attachments={
          imageAttachmentsEnabled && !isCommentMode ? (
            <AttachmentPreviewTray
              attachments={attachments}
              onRemove={removeAttachment}
            />
          ) : null
        }
        controls={
          <>
            {!isCommentMode ? (
              <>
                <Tooltip
                  content={
                    realtimeActive ? `Stop voice mode` : `Start voice mode`
                  }
                  side="top"
                >
                  <span className={styles.tooltipTrigger}>
                    <button
                      type="button"
                      aria-label={
                        realtimeActive ? `Stop voice mode` : `Start voice mode`
                      }
                      onClick={handleRealtimeToggle}
                      disabled={!canUseRealtime || realtimePending}
                      className={[
                        styles.inlineIconButton,
                        realtimeActive ? styles.voiceActive : null,
                      ]
                        .filter(Boolean)
                        .join(` `)}
                    >
                      <Icon icon={realtimeActive ? MicOff : Mic} size={2} />
                    </button>
                  </span>
                </Tooltip>
                <div
                  className={styles.voiceMeter}
                  data-active={
                    realtimeActive || realtimePending ? `true` : `false`
                  }
                  aria-hidden="true"
                >
                  {voiceBars.map((scale, index) => (
                    <span
                      key={index}
                      className={styles.voiceMeterBar}
                      style={{
                        opacity: realtimeActive
                          ? Math.max(0.38, Math.min(1, scale + 0.12))
                          : 0.28,
                        transform: `scaleY(${scale})`,
                      }}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {imageAttachmentsEnabled && !isCommentMode ? (
              <AttachmentActionMenu
                disabled={!canAttachFiles}
                accept={imageAttachmentDraftPolicy.accept}
                fileInputRef={fileInputRef}
                onFilesSelected={addAttachments}
                onAttach={openAttachmentPicker}
              />
            ) : null}
          </>
        }
        send={
          <Tooltip content={sendTooltip} side="top">
            <span className={styles.tooltipTrigger}>
              <button
                type="button"
                aria-label={
                  showStop
                    ? `Stop generating`
                    : isCommentMode
                      ? `Post comment`
                      : `Send message`
                }
                // Keep the textarea focused when the user taps Send on a
                // touch device. Without this, tapping the button blurs the
                // textarea, dismisses the on-screen keyboard, and the
                // viewport reflows between pointerdown and pointerup — the
                // resulting `click` lands on a different element and the
                // send never fires. `preventDefault` here skips the implicit
                // focus transfer; the `click` still dispatches normally.
                onPointerDown={(e) => {
                  if (e.pointerType !== `mouse`) e.preventDefault()
                }}
                onClick={handleComposerAction}
                disabled={showStop ? !canStop : !isButtonActive}
                className={[
                  styles.composerSend,
                  isButtonActive ? styles.active : null,
                  showStop ? styles.stop : null,
                  stopPending && showStop ? styles.stopPending : null,
                ]
                  .filter(Boolean)
                  .join(` `)}
              >
                <Icon
                  icon={showStop ? Square : ArrowUp}
                  size={showStop ? 2 : 3}
                  {...(showStop
                    ? { fill: `currentColor`, strokeWidth: 0 }
                    : {})}
                />
              </button>
            </span>
          </Tooltip>
        }
      >
        <ComposerEditor
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          slashCommands={effectiveSlashCommands}
          placeholder={
            disabled
              ? (disabledPlaceholder ?? `Entity stopped`)
              : isCommentMode
                ? `Add a comment...`
                : `Send a message...`
          }
          disabled={inputDisabled}
        />
      </ComposerShell>
      {!editingMessage && !commentOnly && commentsAvailable && (
        <div
          className={styles.modeTabs}
          role="tablist"
          aria-label="Composer mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!isCommentMode}
            className={styles.modeTab}
            onClick={() => setComposerMode(`prompt`)}
          >
            Prompt
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isCommentMode}
            className={styles.modeTab}
            onClick={() => setComposerMode(`comment`)}
          >
            Comment
          </button>
        </div>
      )}
    </Stack>
  )
}

function formatReplyBannerLabel(target: SelectedCommentTarget | null): string {
  const label = target?.snapshot.label.trim()
  if (!label) return `Reply`
  return `Reply to ${label.charAt(0).toLowerCase()}${label.slice(1)}`
}
