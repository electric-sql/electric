import { useState, useRef, useEffect } from 'react'
import { Box, Flex, IconButton, TextArea } from '@radix-ui/themes'
import { makeStyles } from '@griffel/react'
import { Send } from 'lucide-react'
import { useAuth } from '../../db/auth'
import { eventCollection } from '../../db/collections'

const useStyles = makeStyles({
  container: {
    borderTop: '1px solid var(--border-color)',
    flexShrink: 0,
    padding: 'var(--space-4)',
  },
  textarea: {
    resize: 'none',
    minHeight: '40px',
    maxHeight: '20vh',
    paddingRight: 'var(--space-8)',
    backgroundColor: 'transparent',
  },
  sendWrapper: {
    position: 'absolute',
    top: '50%',
    right: 'var(--space-2)',
    transform: 'translateY(-50%)',
    zIndex: 1,
  },
  sendButton: {
    color: '#fff',
  },
})

type Props = {
  threadId: string
}

function ChatInput({ threadId }: Props) {
  const classes = useStyles()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { currentUserId } = useAuth()
  const [message, setMessage] = useState('')

  const focus = () => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  // Focus input on mount
  useEffect(() => {
    focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') {
      return
    }

    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
      return
    }

    handleSubmit(e)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      return
    }

    eventCollection.insert({
      id: crypto.randomUUID(),
      thread_id: threadId,
      user_id: currentUserId!,
      type: 'text',
      data: {
        text: trimmedMessage as string,
      },
    })

    setMessage('')

    focus()
  }

  // Auto-resize textarea as content grows
  // XXX todo: throttle
  // XXX todo: handle window resize
  const adjustTextareaHeight = () => {
    if (!inputRef.current) return

    const textarea = inputRef.current
    textarea.style.height = 'auto'

    const maxHeight = window.innerHeight * 0.2 // 20% of screen height
    const newHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${newHeight}px`
  }

  useEffect(() => {
    adjustTextareaHeight()
  }, [message])

  return (
    <Box className={classes.container}>
      <form onSubmit={handleSubmit}>
        <Box style={{ position: 'relative' }}>
          <TextArea
            ref={inputRef}
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={classes.textarea}
            onKeyDown={handleKeyDown}
          />
          <Flex
            direction="row"
            gap="2"
            align="center"
            className={classes.sendWrapper}
          >
            <IconButton
              type="submit"
              size="2"
              variant="solid"
              radius="full"
              disabled={!message.trim()}
              className={classes.sendButton}
            >
              <Send size={16} />
            </IconButton>
          </Flex>
        </Box>
      </form>
    </Box>
  )
}

export default ChatInput
