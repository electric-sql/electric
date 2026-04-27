import { Box, Text } from '@radix-ui/themes'
import type { Message } from '../../server/schema.js'

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === `user`

  return (
    <Box className={`message ${isUser ? `message-user` : `message-agent`}`}>
      {!isUser && (
        <Box mb="1">
          <Text size="1" weight="bold" color="gray">
            {message.senderName}
          </Text>
        </Box>
      )}
      <Text
        size="2"
        style={{ whiteSpace: `pre-wrap`, wordBreak: `break-word` }}
      >
        {message.text}
      </Text>
    </Box>
  )
}
