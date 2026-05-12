import { memo } from 'react'
import { Square } from 'lucide-react'
import type { EntityTimelineSection } from '@electric-ax/agents-runtime/client'
import { Icon, Stack, Text } from '../ui'
import { TimeText } from './TimeText'
import styles from './UserMessage.module.css'

type UserMessageSection = Extract<
  EntityTimelineSection,
  { kind: `user_message` }
>

export const UserMessage = memo(function UserMessage({
  section,
  showStop = false,
  stopPending = false,
  onStop,
}: {
  section: UserMessageSection
  showStop?: boolean
  stopPending?: boolean
  onStop?: () => void
}): React.ReactElement {
  const sender = formatSender(section.from)

  return (
    <Stack direction="column" gap={1} className={styles.root}>
      <Stack
        p={3}
        className={[styles.bubble, showStop ? styles.withStop : null]
          .filter(Boolean)
          .join(` `)}
      >
        {showStop && onStop && (
          <button
            type="button"
            aria-label="Stop generating"
            title="Stop generating"
            className={[
              styles.stopButton,
              stopPending ? styles.stopPending : null,
            ]
              .filter(Boolean)
              .join(` `)}
            disabled={stopPending}
            onClick={onStop}
          >
            <Icon icon={Square} size={2} fill="currentColor" strokeWidth={0} />
          </button>
        )}
        <Text size={2} className={styles.body}>
          {section.text}
        </Text>
      </Stack>
      <Stack gap={2} align="center" className={styles.meta}>
        <Text size={1} tone="muted" title={sender.title}>
          {sender.label}
        </Text>
        {section.timestamp && (
          <>
            <Text size={1} tone="muted">
              ·
            </Text>
            <TimeText ts={section.timestamp} />
          </>
        )}
      </Stack>
    </Stack>
  )
})

function formatSender(from: string | null | undefined): {
  label: string
  title?: string
} {
  if (!from) return { label: `user` }
  if (!from.startsWith(`/principal/`)) return { label: from }
  const segment = from.slice(`/principal/`.length)
  if (!segment || segment.includes(`/`)) return { label: from }
  try {
    const key = decodeURIComponent(segment)
    const colon = key.indexOf(`:`)
    if (colon <= 0) return { label: key, title: from }
    const kind = key.slice(0, colon)
    const id = key.slice(colon + 1)
    return {
      label: `${kind}:${formatPrincipalId(id)}`,
      title: key,
    }
  } catch {
    return { label: from }
  }
}

function formatPrincipalId(id: string): string {
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}…${id.slice(-6)}`
}
