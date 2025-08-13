import type { ReactNode } from 'react'
import type { EventResult, UserBadgeColor } from '../../types'

import { Box, Flex, Text, Badge } from '@radix-ui/themes'
import { makeStyles } from '@griffel/react'
import { useRelativeTime } from '../../hooks/useRelativeTime'
import UserAvatar from '../UserAvatar'

const useStyles = makeStyles({
  message: {
    display: 'flex',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
    maxWidth: '100%',
  },
  avatar: {
    flexShrink: 0,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  messageText: {
    wordWrap: 'break-word',
    whiteSpace: 'pre-wrap',
    fontSize: '13px',
  },
  timestamp: {
    fontSize: '10px',
    opacity: 0.7,
  },
  userBadge: {
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    display: 'inline',
    verticalAlign: 'middle',
    paddingTop: '1.5px',
    paddingBottom: '2px',
  },
})

interface Props {
  event: EventResult
  userBadgeColor: UserBadgeColor
  userName: string
  children?: ReactNode
  label?: string
}

function TextMessage({
  children,
  event,
  label,
  userBadgeColor,
  userName,
}: Props) {
  const classes = useStyles()
  const timeStr = useRelativeTime(event.inserted_at)

  return (
    <Box className={classes.message}>
      <Box className={classes.avatar}>
        <UserAvatar
          username={event.user_name}
          imageUrl={event.user_avatar}
          size="medium"
          showTooltip={false}
        />
      </Box>
      <Box className={classes.content}>
        <Flex align="center" gap="2" mb="1">
          <Badge
            size="2"
            variant="soft"
            color={userBadgeColor}
            className={classes.userBadge}
          >
            {userName}
          </Badge>
          {label && (
            <Badge
              size="1"
              variant="soft"
              color={'yellow'}
              className={classes.timestamp}
            >
              {label}
            </Badge>
          )}
          <Text size="1" className={classes.timestamp}>
            {timeStr}
          </Text>
        </Flex>
        <Text size="2" className={classes.messageText}>
          {children || event.data.text}
        </Text>
      </Box>
    </Box>
  )
}

export default TextMessage
