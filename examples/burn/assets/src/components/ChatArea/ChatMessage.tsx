import { useAuth } from '../../db/auth'
import type { EventResult } from '../../types'

import SystemMessage from './SystemMessage'
import TextMessage from './TextMessage'
import ToolUseMessage from './ToolUseMessage'
import ToolResultMessage from './ToolResultMessage'

const messageComponents = {
  system: SystemMessage,
  text: TextMessage,
  tool_use: ToolUseMessage,
  tool_result: ToolResultMessage,
}

interface Props {
  event: EventResult
}

function ChatMessage({ event }: Props) {
  const { currentUserId } = useAuth()

  const userName = event.user_id === currentUserId ? 'you' : event.user_name
  const userBadgeColor = event.user_type === 'human' ? 'blue' : 'purple'

  const MessageComponent = messageComponents[event.type]!

  return (
    <MessageComponent
      event={event}
      userName={userName}
      userBadgeColor={userBadgeColor}
    />
  )
}

export default ChatMessage
