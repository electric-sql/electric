import {
  Avatar,
  IconButton,
  Badge,
  Box,
  Button,
  Collapse,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
} from '@mui/material'
import { Notifications } from '@mui/icons-material'
import { ReactElement, useState } from 'react'
import { Activity_events } from '../generated/client'

/**
 * Formats a date to a human-readable timestamp.
 * @param date - the date to format
 * @returns {string}
 */
function formatDateTime(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }
  const formattedDate = date.toLocaleDateString(navigator.language, options)
  return formattedDate
}

export const ActivityPopoverView = ({
  recentActivities,
  numUnreadActivities,
  onActivityRead,
  onAllActivitiesRead,
}: {
  recentActivities: Activity_events[]
  numUnreadActivities: number
  onActivityRead: (activityId: string) => void
  onAllActivitiesRead: () => void
}) => {
  const hasUnreadActivities = numUnreadActivities > 0
  return (
    <NotificationPopover showBadge={hasUnreadActivities}>
      <Box pb={1}>
        <List>
          {recentActivities.map((activity) => (
            <ListItemButton
              key={activity.id}
              onPointerEnter={() => (activity.read_at ? null : onActivityRead(activity.id))}>
              <ListItemIcon>
                <Avatar>{activity.message.split(' ')[0].slice(0, 1)}</Avatar>
              </ListItemIcon>
              <ListItemText
                primary={activity.message}
                secondary={formatDateTime(activity.timestamp)}
              />
              <Badge
                color="secondary"
                variant="dot"
                invisible={activity.read_at !== null}
                sx={{ width: 24 }}
              />
            </ListItemButton>
          ))}
        </List>

        <Button fullWidth>
          {'See all activities' + (hasUnreadActivities ? ` (${numUnreadActivities} unread)` : '')}
        </Button>

        <Collapse in={hasUnreadActivities} collapsedSize={0}>
          <Button fullWidth disabled={!hasUnreadActivities} onClick={onAllActivitiesRead}>
            Mark all as read
          </Button>
        </Collapse>
      </Box>
    </NotificationPopover>
  )
}

const NotificationPopover = ({
  children,
  showBadge = false,
}: {
  children: ReactElement[] | ReactElement
  showBadge: boolean
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)}>
        <Badge color="secondary" variant="dot" invisible={!showBadge}>
          <Notifications />
        </Badge>
      </IconButton>
      <Popover
        open={anchorEl !== null}
        onClose={() => setAnchorEl(null)}
        anchorEl={anchorEl}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}>
        {children}
      </Popover>
    </>
  )
}
