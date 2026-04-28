import { useState, useRef, useEffect } from 'react'
import { Box, Flex, Text, Button, TextField } from '@radix-ui/themes'
import { useLiveQuery } from '@tanstack/react-db'
import type { Message } from '../../server/schema.js'
import type {
  MessagesCollection,
  AgentsCollection,
} from '../hooks/useChatroom.js'
import { MessageBubble } from './MessageBubble.js'
import { TypingIndicators } from './TypingIndicator.js'

export function ChatArea({
  messagesCollection,
  agentsCollection,
  agentsUrl,
  connected,
  error,
  onSend,
  roomName,
}: {
  messagesCollection: MessagesCollection | null
  agentsCollection: AgentsCollection | null
  agentsUrl: string
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

  const hasUserMessages = messages.some((m: any) => m.role === `user`)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: `smooth` })
  }, [messages.length])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput(``)
    onSend(text)
  }

  return (
    <Flex direction="column" flexGrow="1" style={{ minWidth: 0 }}>
      {error && (
        <Box px="3" py="2" className="chat-error">
          <Text size="1" color="red">
            {error}
          </Text>
        </Box>
      )}

      <Box flexGrow="1" className="chat-messages">
        {!roomName && (
          <Flex align="center" justify="center" style={{ height: `100%` }}>
            <Text size="2" color="gray">
              Select or create a room to start chatting
            </Text>
          </Flex>
        )}
        {roomName && messages.length === 0 && (
          <Flex align="center" justify="center" style={{ height: `100%` }}>
            <Text size="2" color="gray">
              {connected
                ? `Send a message to start chatting`
                : `Connecting to room...`}
            </Text>
          </Flex>
        )}
        {messages.map((msg: any, idx: number) => (
          <MessageBubble key={msg.key ?? idx} message={msg as Message} />
        ))}
        <TypingIndicators
          agentsCollection={agentsCollection}
          agentsUrl={agentsUrl}
          hasUserMessages={hasUserMessages}
        />
        <div ref={bottomRef} />
      </Box>

      <Flex px="3" py="2" gap="2" className="panel-footer">
        <Box flexGrow="1">
          <TextField.Root
            size="2"
            placeholder={roomName ? `Message #${roomName}` : `Select a room...`}
            value={input}
            disabled={!roomName}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === `Enter` && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
        </Box>
        <Button onClick={handleSend} disabled={!roomName || !input.trim()}>
          Send
        </Button>
      </Flex>
    </Flex>
  )
}
