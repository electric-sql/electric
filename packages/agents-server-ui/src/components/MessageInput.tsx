import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowUp, Square } from 'lucide-react'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import {
  createDeleteInboxMessageAction,
  createSendMessageAction,
  createSteerInboxMessageAction,
  createUpdateInboxMessageAction,
  readTextPayload,
} from '../lib/sendMessage'
import { Icon, Stack, Text } from '../ui'
import {
  AttachmentActionMenu,
  AttachmentPreviewTray,
  imageAttachmentDraftPolicy,
  useAttachmentDrafts,
} from './AttachmentDrafts'
import styles from './MessageInput.module.css'
import type { EntityTimelineData } from '@electric-ax/agents-runtime/client'
import type { OptimisticInboxMessage } from '../lib/sendMessage'

export function MessageInput({
  db,
  baseUrl,
  entityUrl,
  disabled,
  generationActive = false,
  stopPending = false,
  imageAttachmentsEnabled = true,
  pendingMessages = [],
  inlineQueuedSubmits = false,
  onOptimisticQueuedMessage,
  drawer,
  onSend,
  onStop,
}: {
  db: EntityStreamDBWithActions | null
  baseUrl: string
  entityUrl: string
  disabled: boolean
  generationActive?: boolean
  stopPending?: boolean
  imageAttachmentsEnabled?: boolean
  pendingMessages?: EntityTimelineData[`inbox`]
  inlineQueuedSubmits?: boolean
  onOptimisticQueuedMessage?: (message: OptimisticInboxMessage) => void
  onSend?: () => void
  onStop?: () => void
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
  }) => React.ReactNode
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [error, setError] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<{
    key: string
    originalText: string
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachmentsDisabled =
    disabled || Boolean(editingMessage) || !imageAttachmentsEnabled
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
    focusRef: textareaRef,
  })

  useEffect(() => {
    if (!imageAttachmentsEnabled) clearAttachments()
  }, [imageAttachmentsEnabled, clearAttachments])

  // Auto-grow the composer as the user types. We reset to `auto`
  // first so `scrollHeight` reports the natural content height (not
  // the previous explicit height), then assign that back as inline
  // height. The CSS `max-height` caps it; `overflow: auto` then
  // takes over for anything past the cap. Runs in layout effect so
  // the resize lands before paint and there's no one-frame flicker.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = `auto`
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  const sendAction = useMemo(() => {
    if (!db) return null
    return createSendMessageAction({
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
  const attachmentCount = imageAttachmentsEnabled ? attachments.length : 0
  const canSubmit =
    !disabled &&
    (editingMessage
      ? inputText.length > 0
      : inputText.length > 0 || attachmentCount > 0)
  const canAttachFiles = !disabled && !editingMessage && imageAttachmentsEnabled
  const showStop =
    generationActive &&
    inputText.length === 0 &&
    attachmentCount === 0 &&
    !disabled
  const canStop = showStop && !stopPending

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return
    setError(null)
    const text = value.trim()
    const files = imageAttachmentsEnabled ? attachments : []
    const tx = editingMessage
      ? updateAction?.({
          key: editingMessage.key,
          text,
          mode: `queued`,
          status: `pending`,
        })
      : sendAction?.({
          text,
          mode: `queued`,
          attachments: files,
        })
    if (!tx) return
    if (!editingMessage) onSend?.()
    setValue(``)
    clearAttachments()
    setEditingMessage(null)
    tx.isPersisted.promise.catch((err: Error) => {
      setError(err.message)
    })
  }, [
    attachments,
    imageAttachmentsEnabled,
    canSubmit,
    clearAttachments,
    editingMessage,
    onSend,
    sendAction,
    updateAction,
    value,
  ])

  const handleComposerAction = useCallback(() => {
    if (canStop) {
      onStop?.()
      return
    }
    handleSubmit()
  }, [canStop, handleSubmit, onStop])

  const startEditing = useCallback(
    (message: EntityTimelineData[`inbox`][number]) => {
      const text = readTextPayload(message.payload)
      setError(null)
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
      textareaRef.current?.focus()
    },
    [clearAttachments, updateAction]
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
      if (!deleteAction) return
      setError(null)
      deleteAction({ key }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      if (editingMessage?.key === key) cancelEditing()
    },
    [deleteAction, editingMessage?.key, cancelEditing]
  )

  const steerMessage = useCallback(
    (key: string) => {
      if (!steerAction) return
      setError(null)
      steerAction({ key }).isPersisted.promise.catch((err: Error) => {
        setError(err.message)
      })
      if (editingMessage?.key === key) cancelEditing()
    },
    [steerAction, editingMessage?.key, cancelEditing]
  )
  const reorderMessage = useCallback(
    (key: string, position: string) => {
      if (!updateAction) return
      setError(null)
      updateAction({ key, position }).isPersisted.promise.catch(
        (err: Error) => {
          setError(err.message)
        }
      )
    },
    [updateAction]
  )

  const isButtonActive = canSubmit || showStop

  return (
    <Stack direction="column" gap={0} className={styles.root}>
      {drawer?.({
        pendingMessages,
        editingKey: editingMessage?.key ?? null,
        onEdit: startEditing,
        onDelete: deleteMessage,
        onSteer: steerMessage,
        onReorder: reorderMessage,
      })}
      {error && (
        <Text size={1} tone="danger" className={styles.errorText}>
          {error}
        </Text>
      )}
      <div
        className={[
          styles.composer,
          disabled ? styles.disabled : null,
          dropActive ? styles.composerDropActive : null,
        ]
          .filter(Boolean)
          .join(` `)}
        {...dropZoneProps}
      >
        {editingMessage && (
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
        )}
        {imageAttachmentsEnabled && (
          <AttachmentPreviewTray
            attachments={attachments}
            onRemove={removeAttachment}
          />
        )}
        <div className={styles.composerBody}>
          {imageAttachmentsEnabled && (
            <AttachmentActionMenu
              disabled={!canAttachFiles}
              accept={imageAttachmentDraftPolicy.accept}
              fileInputRef={fileInputRef}
              onFilesSelected={addAttachments}
              onAttach={openAttachmentPicker}
            />
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={handlePaste}
            // Tell mobile virtual keyboards that Enter means "send" so the
            // GBoard / iOS keyboard surfaces a send-shaped action key and
            // — critically on Android Chrome — fires `keydown` with
            // `key === 'Enter'` reliably. Without this hint the soft
            // keyboard's return key inside a textarea inserts a newline
            // and may fire `key === 'Unidentified'` / `keyCode === 229`.
            enterKeyHint="send"
            onKeyDown={(e) => {
              if (e.key !== `Enter` || e.shiftKey) return
              // Don't submit while an IME composition is in progress —
              // Enter is committing the candidate, not sending. Android
              // Chrome reports composing as `keyCode === 229` rather than
              // setting `isComposing`, so check both.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              e.preventDefault()
              handleSubmit()
            }}
            // Fallback for soft keyboards (notably Android Chrome / GBoard)
            // that route the return key through `beforeinput` as an
            // `insertLineBreak` without firing a `keydown` we can match
            // on `key === 'Enter'`.
            onBeforeInput={(e) => {
              if (
                (e.nativeEvent as InputEvent).inputType === `insertLineBreak`
              ) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder={disabled ? `Entity stopped` : `Send a message...`}
            disabled={disabled}
            rows={1}
            data-agent-chat-input=""
            className={styles.textarea}
          />
          <button
            type="button"
            aria-label={showStop ? `Stop generating` : `Send message`}
            title={showStop ? `Stop generating` : `Send message`}
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
            disabled={showStop ? stopPending : !isButtonActive}
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
              {...(showStop ? { fill: `currentColor`, strokeWidth: 0 } : {})}
            />
          </button>
        </div>
      </div>
    </Stack>
  )
}
