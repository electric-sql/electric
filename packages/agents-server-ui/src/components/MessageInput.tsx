import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { createOptimisticAction } from '@tanstack/db'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'
import { Stack, Text } from '../ui'
import styles from './MessageInput.module.css'

export function MessageInput({
  db,
  baseUrl,
  entityUrl,
  disabled,
  drawer,
}: {
  db: EntityStreamDBWithActions | null
  baseUrl: string
  entityUrl: string
  disabled: boolean
  /**
   * Optional content rendered above the composer, sharing its docked
   * width and lift into the timeline above. The composer is z-indexed
   * over whatever the drawer renders so the drawer can extend its
   * bottom edge underneath the composer for a "tray" effect (see
   * `EntityContextDrawer`).
   */
  drawer?: React.ReactNode
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [error, setError] = useState<string | null>(null)
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
    return createOptimisticAction<{ text: string }>({
      onMutate: ({ text }) => {
        ;(db.collections as any).inbox.insert({
          key: `optimistic-${Date.now()}`,
          from: `user`,
          payload: { text },
          timestamp: new Date().toISOString(),
        })
      },
      mutationFn: async ({ text }) => {
        const res = await fetch(`${baseUrl}${entityUrl}/send`, {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ from: `user`, payload: { text } }),
        })
        if (!res.ok) {
          const body = await res.text().catch(() => ``)
          let message = `Send failed (${res.status})`
          if (body) {
            try {
              const data = JSON.parse(body) as Record<string, unknown>
              if (data.message) message = String(data.message)
            } catch {
              message = body
            }
          }
          throw new Error(message)
        }
      },
    })
  }, [db, baseUrl, entityUrl])

  const handleSubmit = useCallback(() => {
    if (!value.trim() || !sendAction || disabled) return
    setError(null)
    const tx = sendAction({ text: value.trim() })
    setValue(``)
    tx.isPersisted.promise.catch((err: Error) => {
      setError(err.message)
    })
  }, [value, sendAction, disabled])

  const isActive = Boolean(value.trim() && !disabled)

  return (
    <Stack direction="column" gap={0} className={styles.root}>
      {drawer}
      {error && (
        <Text size={1} tone="danger" className={styles.errorText}>
          {error}
        </Text>
      )}
      <Stack
        align="end"
        gap={2}
        className={[styles.composer, disabled ? styles.disabled : null]
          .filter(Boolean)
          .join(` `)}
      >
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
          <ArrowUp size={16} />
        </button>
      </Stack>
    </Stack>
  )
}
