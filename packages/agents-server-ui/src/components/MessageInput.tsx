import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime/client'
import {
  createDeleteInboxMessageAction,
  createSendMessageAction,
  createSteerInboxMessageAction,
  createUpdateInboxMessageAction,
  readTextPayload,
} from '../lib/sendMessage'
import { ComposerSettings } from './SessionSettingsPopover'
import { Icon, Stack, Text } from '../ui'
import styles from './MessageInput.module.css'
import type { EntityTimelineData } from '@electric-ax/agents-runtime/client'
import type { OptimisticInboxMessage } from '../lib/sendMessage'
import type {
  ElectricEntity,
  ElectricEntityType,
} from '../lib/ElectricAgentsProvider'

export function MessageInput({
  db,
  baseUrl,
  entityUrl,
  disabled,
  pendingMessages = [],
  inlineQueuedSubmits = false,
  onOptimisticQueuedMessage,
  entity,
  entityType,
  drawer,
  onSend,
}: {
  db: EntityStreamDBWithActions | null
  baseUrl: string
  entityUrl: string
  disabled: boolean
  pendingMessages?: EntityTimelineData[`inbox`]
  inlineQueuedSubmits?: boolean
  onOptimisticQueuedMessage?: (message: OptimisticInboxMessage) => void
  /** The entity whose session this composer belongs to. When provided,
   *  inline model + CWD controls appear in the composer footer so the
   *  user can change them at any point during the session. */
  entity?: ElectricEntity
  /** The entity type, used to read creation_schema for model options. */
  entityType?: ElectricEntityType | null
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
  onSend?: () => void
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [error, setError] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<{
    key: string
    originalText: string
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  const handleSubmit = useCallback(() => {
    if (!value.trim() || disabled) return
    setError(null)
    const text = value.trim()
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
        })
    if (!tx) return
    if (!editingMessage) onSend?.()
    setValue(``)
    setEditingMessage(null)
    tx.isPersisted.promise.catch((err: Error) => {
      setError(err.message)
    })
  }, [value, sendAction, updateAction, editingMessage, disabled, onSend])

  const startEditing = useCallback(
    (message: EntityTimelineData[`inbox`][number]) => {
      const text = readTextPayload(message.payload)
      setError(null)
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
    [updateAction]
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
  }, [editingMessage, updateAction])

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

  const isActive = Boolean(value.trim() && !disabled)

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
        className={[styles.composer, disabled ? styles.disabled : null]
          .filter(Boolean)
          .join(` `)}
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
        <div className={styles.composerBody}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === `Enter` && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder={disabled ? `Entity stopped` : `Send a message...`}
            disabled={disabled}
            rows={1}
            className={styles.textarea}
          />
          <button
            type="button"
            aria-label="Send message"
            onClick={handleSubmit}
            disabled={!isActive}
            className={[styles.composerSend, isActive ? styles.active : null]
              .filter(Boolean)
              .join(` `)}
          >
            <Icon icon={ArrowUp} size={3} />
          </button>
        </div>
      </div>
      <div className={styles.composerFooter}>
        <div className={styles.composerControls}>
          {entity && (
            <ComposerSettings
              entity={entity}
              entityType={entityType ?? null}
              baseUrl={baseUrl}
              disabled={disabled}
            />
          )}
        </div>
        <button
          type="button"
          aria-label="Send message"
          onClick={handleSubmit}
          disabled={!isActive}
          className={[styles.composerSend, isActive ? styles.active : null]
            .filter(Boolean)
            .join(` `)}
        >
          <Icon icon={ArrowUp} size={3} />
        </button>
      </div>
    </Stack>
  )
}
