import { useCallback, useState } from 'react'
import { ChatRoomView } from './ChatRoomView'
import { useChatRoom } from './use_chat_room'

const MINUTE = 60 * 1000

export const ChatRoom = ({ username }: { username: string }) => {
  const [oldestMessageTime, setOldestMessageTime] = useState(new Date(Date.now() - 30 * MINUTE))
  const onViewOlderMessages = useCallback(
    () => setOldestMessageTime((oldest) => new Date(oldest.getTime() - 60 * MINUTE)),
    [],
  )

  const { messages, hasOlderMessages, sendMessage } = useChatRoom({ username, oldestMessageTime })

  return (
    <ChatRoomView
      messages={messages}
      onMessageSent={sendMessage}
      onOlderMessagesRequested={hasOlderMessages ? onViewOlderMessages : undefined}
    />
  )
}
