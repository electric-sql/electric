import { useCallback, useMemo, useState } from 'react'
import { Flex, Text } from '@radix-ui/themes'
import { ArrowUp } from 'lucide-react'
import { createOptimisticAction } from '@tanstack/db'
import type { EntityStreamDBWithActions } from '@electric-ax/agent-runtime'

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

  return (
    <Flex
      direction="column"
      gap="1"
      style={{
        borderTop: `1px solid var(--gray-a3)`,
        padding: `16px 0`,
        maxWidth: `72ch`,
        margin: `0 auto`,
        width: `100%`,
        boxSizing: `border-box`,
        paddingLeft: 40,
        paddingRight: 40,
      }}
    >
      {error && (
        <Text size="1" color="red">
          {error}
        </Text>
      )}
      <Flex
        align="end"
        gap="2"
        style={{
          background: `var(--gray-a2)`,
          border: `1px solid var(--gray-a4)`,
          borderRadius: 12,
          padding: `12px 16px`,
          width: `100%`,
          opacity: disabled ? 0.5 : 1,
          transition: `border-color 0.15s`,
        }}
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
          style={{
            flex: 1,
            border: `none`,
            outline: `none`,
            background: `transparent`,
            fontSize: `var(--font-size-2)`,
            color: `var(--gray-12)`,
            resize: `none`,
            overflow: `auto`,
            lineHeight: 1.5,
            maxHeight: 200,
            fontFamily: `var(--default-font-family)`,
          }}
        />
        <ArrowUp
          size={18}
          style={{
            color:
              value.trim() && !disabled ? `var(--accent-9)` : `var(--gray-8)`,
            cursor: value.trim() && !disabled ? `pointer` : `default`,
            transition: `color 0.15s`,
          }}
          onClick={handleSubmit}
        />
      </Flex>
    </Flex>
  )
}
