import { Avatar, Box, Button, Collapse, Divider, List, ListItem, ListItemIcon, ListItemText, Paper, TextField, Typography } from "@mui/material"
import { useElectric } from "../electric/ElectricWrapper"
import { useLiveQuery } from "electric-sql/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { genUUID } from "electric-sql/util"

const MINUTE = 60 * 1000

export const ChatRoom = ({ username } : { username: string}) => {
  const [ oldestMessageTime, setOldestMessageTime ] = useState(Date.now() - 30 * MINUTE)
  const { db } = useElectric()!
  const { results: messages = [] } = useLiveQuery(db.chat_room.liveMany({
    orderBy: {
      timestamp: 'desc'
    },
    where: {
      timestamp: {
        gte: new Date(oldestMessageTime)
      }
    }
  }))

  const hasOlderMessages = useLiveQuery(db.chat_room.liveFirst({
    orderBy: {
      timestamp: 'desc'
    },
    where: {
      timestamp: {
        lt: new Date(oldestMessageTime)
      }
    }
  })).results !== null

  const sendMessage = useCallback(
    (message:string) => db.chat_room.create({
      data: {
        id: genUUID(),
        timestamp: new Date(),
        username: username,
        message: message
      }
    }),
    [db.chat_room, username]
  )


  const onViewOlderMessages = useCallback(
    () => setOldestMessageTime(oldestMessageTime - 60 * MINUTE),
    [oldestMessageTime]
  )

  return (
    <ChatRoomView
      messages={messages}
      onMessageSent={sendMessage}
      onOlderMessagesRequested={hasOlderMessages ? onViewOlderMessages : undefined}
      />
  )

}


interface Message {
  id: string,
  timestamp: Date,
  username: string,
  message: string
}

const ChatRoomView = ({
  messages,
  onMessageSent,
  onOlderMessagesRequested
} : {
  messages: Message[],
  onMessageSent: (message: string) => void,
  onOlderMessagesRequested?: () => void
}) => {
  const [ typedMessage, setTypedMessage ] = useState('')
  const listRef = useRef<HTMLUListElement>(null)

  const lastMessageId = messages[0]?.id;

  useEffect(() => {
    if (listRef.current?.scrollTop ?? 0 > 0) {
      listRef.current?.scrollTo({
        top: 0,
        behavior: 'smooth'
      })
    }
  }, [lastMessageId])

  const handleMessageSent = () => {
    onMessageSent(typedMessage)
    setTypedMessage('')
  }

  return (
    <Paper sx={{ p: 2 }}>
      <List ref={listRef} sx={{
        maxHeight: '70vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column-reverse'
        }}>
        {messages.map((message) => (
          <ListItem key={message.id}>

            <ListItemIcon>
              <Avatar>{message.username[0]}</Avatar>
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
          onClick={handleMessageSent}
        >
          Send
        </Button>
      </Box>
    </Paper>
  )
}