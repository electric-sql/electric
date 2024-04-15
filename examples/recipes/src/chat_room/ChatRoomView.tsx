import {
  Avatar,
  Box,
  Button,
  Collapse,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { stringAvatar } from './utilities'

interface Message {
  id: string
  timestamp: Date
  username: string
  message: string
}

export const ChatRoomView = ({
  messages,
  onMessageSent,
  onOlderMessagesRequested,
}: {
  messages: Message[]
  onMessageSent: (message: string) => void
  onOlderMessagesRequested?: () => void
}) => {
  const listRef = useRef<HTMLUListElement>(null)
  const lastMessageId = messages[0]?.id

  useEffect(() => {
    if (listRef.current?.scrollTop ?? 0 > 0) {
      listRef.current?.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    }
  }, [lastMessageId])

  return (
    <Paper sx={{ p: 2 }}>
      <List
        ref={listRef}
        sx={{
          maxHeight: '70vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column-reverse',
        }}>
        {messages.map((message) => (
          <ListItem key={message.id}>
            <ListItemIcon>
              <Avatar {...stringAvatar(message.username)} />
            </ListItemIcon>
            <ListItemText
              primary={message.username}
              secondary={
                <>
                  <Typography component="span" variant="body2" color="textPrimary">
                    {message.message}
                  </Typography>
                  <br />
                  <Typography component="span" variant="caption" color="textSecondary">
                    {message.timestamp.toLocaleString()}
                  </Typography>
                </>
              }
            />
          </ListItem>
        ))}

        <ListItem key="older-messages">
          <Collapse in={!!onOlderMessagesRequested} sx={{ width: '100%' }}>
            <Button fullWidth onClick={onOlderMessagesRequested}>
              View older messages
            </Button>
          </Collapse>
        </ListItem>
      </List>

      <Divider color="white" sx={{ my: 2 }} />

      <ChatRoomInputView onMessageSent={onMessageSent} />
    </Paper>
  )
}

const ChatRoomInputView = ({ onMessageSent }: { onMessageSent: (messsage: string) => void }) => {
  const [typedMessage, setTypedMessage] = useState('')
  const handleMessageSent = () => {
    onMessageSent(typedMessage)
    setTypedMessage('')
  }

  return (
    <Box sx={{ display: 'flex' }}>
      <TextField
        label="Type your message"
        variant="outlined"
        color="secondary"
        fullWidth
        value={typedMessage}
        onKeyDown={(evt) => {
          if (evt.key === 'Enter') {
            evt.preventDefault()
            handleMessageSent()
          }
        }}
        onChange={(e) => setTypedMessage(e.target.value)}
      />
      <Button
        variant="contained"
        color="primary"
        sx={{ ml: 2, minWidth: 100 }}
        onClick={handleMessageSent}>
        Send
      </Button>
    </Box>
  )
}
