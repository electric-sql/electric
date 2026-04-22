import { memo } from 'react'
import { Flex, Text } from '@radix-ui/themes'
import type { EntityTimelineSection } from '@electric-ax/agent-runtime'

type UserMessageSection = Extract<
  EntityTimelineSection,
  { kind: `user_message` }
>

export const UserMessage = memo(function UserMessage({
  section,
}: {
  section: UserMessageSection
}): React.ReactElement {
  const time = section.timestamp
    ? new Date(section.timestamp).toLocaleTimeString([], {
        hour: `2-digit`,
        minute: `2-digit`,
      })
    : ``

  const sender = section.from ?? `user`

  return (
    <Flex direction="column" gap="1" style={{ maxWidth: `68ch` }}>
      <Flex
        p="3"
        style={{
          background: `var(--gray-a3)`,
          borderRadius: 12,
        }}
      >
        <Text size="2" style={{ lineHeight: 1.55, whiteSpace: `pre-wrap` }}>
          {section.text}
        </Text>
      </Flex>
      <Flex gap="2" align="center" style={{ opacity: 0.4 }}>
        <Text size="1" color="gray">
          {sender}
        </Text>
        {time && (
          <>
            <Text size="1" color="gray">
              ·
            </Text>
            <Text size="1" color="gray">
              {time}
            </Text>
          </>
        )}
      </Flex>
    </Flex>
  )
})
