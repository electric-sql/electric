import { useCallback, useMemo, useState } from 'react'
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
}: {
  db: EntityStreamDBWithActions | null
  baseUrl: string
  entityUrl: string
  disabled: boolean
}): React.ReactElement {
  const [value, setValue] = useState(``)
  const [error, setError] = useState<string | null>(null)

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
    <Stack direction="column" gap={1} className={styles.root}>
      {error && (
        <Text size={1} tone="danger">
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
          rows={3}
          className={styles.textarea}
        />
        <ArrowUp
          size={18}
          className={[styles.sendIcon, isActive ? styles.active : null]
            .filter(Boolean)
            .join(` `)}
          onClick={handleSubmit}
        />
      </Stack>
    </Stack>
  )
}
