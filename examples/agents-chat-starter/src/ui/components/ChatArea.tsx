import { useState, useRef, useEffect } from 'react'
import { Box, Flex, Text, Button, Heading, TextField } from '@radix-ui/themes'
import { useLiveQuery } from '@tanstack/react-db'
import type { Message } from '../../server/schema.js'
import type { MessagesCollection } from '../hooks/useChatroom.js'
import { MessageBubble } from './MessageBubble.js'

export function ChatArea({
  messagesCollection,
  connected,
  error,
  onSend,
  roomName,
}: {
  messagesCollection: MessagesCollection | null
  connected: boolean
  error: string | null
  onSend: (text: string) => void
  roomName: string | null
}) {
  const [input, setInput] = useState(``)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: messages = [] } = useLiveQuery(
    messagesCollection
      ? (q) =>
          q
            .from({ m: messagesCollection })
            .orderBy(({ m }) => (m as any).timestamp, `asc`)
            .select(({ m }) => m)
      : () => null,
    [messagesCollection]
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: `smooth` })
  }, [messages.length])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput(``)
    onSend(text)
  }

  if (!roomName) {
    return (
      <Flex direction="column" flexGrow="1" align="center" justify="center">
        <Text size="3" color="gray">
          Select or create a room to start chatting
        </Text>
      </Flex>
    )
  }

  return (
    <Flex direction="column" flexGrow="1" style={{ minWidth: 0 }}>
      <Box px="3" py="3" className="chat-header">
        <Heading size="3">
          <Text color="gray"># </Text>
          {roomName}
        </Heading>
      </Box>

      {error && (
        <Box px="3" py="2" className="chat-error">
          <Text size="1" color="red">
            {error}
          </Text>
        </Box>
      )}

      <Box flexGrow="1" className="chat-messages">
        {messages.length === 0 && (
          <Flex align="center" justify="center" style={{ height: `100%` }}>
            <Text size="2" color="gray">
              {connected
                ? `Send a message to start chatting`
                : `Connecting to room...`}
            </Text>
          </Flex>
        )}
        {messages.map((msg: any) => (
          <MessageBubble key={msg.key} message={msg as Message} />
        ))}
        <div ref={bottomRef} />
      </Box>

      <Flex px="3" py="2" gap="2" className="panel-footer">
        <Box flexGrow="1">
          <TextField.Root
            size="2"
            placeholder={`Message #${roomName}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === `Enter` && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
        </Box>
        <Button onClick={handleSend} disabled={!input.trim()}>
          Send
        </Button>
      </Flex>
    </Flex>
  )
}
