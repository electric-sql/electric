import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import {
  createDeleteInboxMessageAction,
  createSendComposerInputAction,
  createSteerInboxMessageAction,
  createUpdateInboxMessageAction,
  readTextPayload,
} from '../lib/sendMessage'
import { serializeComposerInput } from '@electric-ax/agents-runtime/client'
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
  drawer,
  onSend,
  onStop,
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
    disabled: boolean
  }) => React.ReactNode
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [error, setError] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<{
    key: string
    originalText: string
  } | null>(null)
  const composerFocusRef = useRef<{ focus: () => void } | null>(null)
  const inputDisabled = disabled || writeDisabled
  const attachmentsDisabled =
    inputDisabled || Boolean(editingMessage) || !imageAttachmentsEnabled
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

  const { data: slashCommands = [] } = useLiveQuery(
    (q) =>
      db
        ? q
            .from({ slashCommand: db.collections.slashCommands as any })
            .orderBy(({ slashCommand }: any) => slashCommand.name, `asc`)
        : undefined,
    [db]
  )
  const effectiveSlashCommands =
    slashCommands.length > 0
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
    !inputDisabled &&
    (editingMessage
      ? inputText.length > 0
      : inputText.length > 0 || attachmentCount > 0)
  const canAttachFiles =
    !inputDisabled && !editingMessage && imageAttachmentsEnabled
  const showStop =
    generationActive &&
    inputText.length === 0 &&
    attachmentCount === 0 &&
    !disabled
  const canStop = showStop && !stopPending && !stopDisabled

  const handleSubmit = useCallback(
    (composerPayload?: ComposerInputPayload) => {
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
        : sendComposerAction?.({
            payload:
              composerPayload ??
              serializeComposerInput(text, effectiveSlashCommands),
            mode: `queued`,
            ...(files.length > 0 ? { attachments: files } : {}),
          })
      if (!tx) return
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

  const startEditing = useCallback(
    (message: EntityTimelineData[`inbox`][number]) => {
      if (inputDisabled) return
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
    },
    [clearAttachments, inputDisabled, updateAction]
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
  const sendTooltip = showStop
    ? stopDisabled
      ? `Signal permission required`
      : `Stop generating`
    : `Send message`
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
          ) : null
        }
        attachments={
          imageAttachmentsEnabled ? (
            <AttachmentPreviewTray
              attachments={attachments}
              onRemove={removeAttachment}
            />
          ) : null
        }
        controls={
          imageAttachmentsEnabled ? (
            <AttachmentActionMenu
              disabled={!canAttachFiles}
              accept={imageAttachmentDraftPolicy.accept}
              fileInputRef={fileInputRef}
              onFilesSelected={addAttachments}
              onAttach={openAttachmentPicker}
            />
          ) : null
        }
        send={
          <Tooltip content={sendTooltip} side="top">
            <span className={styles.tooltipTrigger}>
              <button
                type="button"
                aria-label={showStop ? `Stop generating` : `Send message`}
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
              : `Send a message...`
          }
          disabled={inputDisabled}
        />
      </ComposerShell>
    </Stack>
  )
}
