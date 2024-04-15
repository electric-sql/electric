import { useCallback } from 'react'
import { useElectric } from '../electric/ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { genUUID } from 'electric-sql/util'

export const useChatRoom = ({
  username,
  oldestMessageTime,
}: {
  username: string
  oldestMessageTime: Date
}) => {
  const { db } = useElectric()!

  // All messages in descending chronological order starting
  // from the given [oldestMessageTime]
  const { results: messages = [] } = useLiveQuery(
    db.chat_room.liveMany({
      where: { timestamp: { gte: oldestMessageTime } },
      orderBy: { timestamp: 'desc' },
    }),
  )

  // Flag indicating whether there are messages older than
  // [oldestMessageTime]
  const hasOlderMessages =
    useLiveQuery(
      db.chat_room.liveFirst({
        where: { timestamp: { lt: oldestMessageTime } },
        orderBy: { timestamp: 'desc' },
      }),
    ).results !== null

  // Submits a message to the chatroom with the given [username]
  const sendMessage = useCallback(
    (message: string) =>
      db.chat_room.create({
        data: {
          id: genUUID(),
          timestamp: new Date(),
          username: username,
          message: message,
        },
      }),
    [db.chat_room, username],
  )

  return {
    messages,
    sendMessage,
    hasOlderMessages,
  }
}
