import { memo } from 'react'
import type { EntityTimelineSection } from '@electric-ax/agents-runtime'
import { Stack, Text } from '../ui'
import { TimeText } from './TimeText'
import styles from './UserMessage.module.css'

type UserMessageSection = Extract<
  EntityTimelineSection,
  { kind: `user_message` }
>

export const UserMessage = memo(function UserMessage({
  section,
}: {
  section: UserMessageSection
}): React.ReactElement {
  const sender = section.from ?? `user`

  return (
    <Stack direction="column" gap={1} className={styles.root}>
      <Stack p={3} className={styles.bubble}>
        <Text size={2} className={styles.body}>
          {section.text}
        </Text>
      </Stack>
      <Stack gap={2} align="center" className={styles.meta}>
        <Text size={1} tone="muted">
          {sender}
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
